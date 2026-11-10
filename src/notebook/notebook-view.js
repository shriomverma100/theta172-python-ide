/**
 * A Jupyter notebook in a tab: code and Markdown cells, outputs below each
 * cell (text, tables, plots, errors) and a kernel on the chosen Python.
 *
 * Keys (like Jupyter):
 *   in a cell    Shift+Enter run and go to the next cell, Ctrl+Enter run,
 *                Alt+Enter run and add a cell below, Esc leave the cell
 *   on a cell    Enter edit, ↑/↓ or K/J move, A/B add above/below, D D delete,
 *                M Markdown, Y code, Shift+↑/↓ move the cell
 */
import { EditorView, keymap, drawSelection, highlightSpecialChars, placeholder } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { cellEditorExtensions, trackCellView } from '../editor.js';
import { sanitizeHTML } from '../core/sanitize-html.js';
import {
  parseNotebook, serializeNotebook, newCell, addMessage, pickMime, stripAnsi,
} from './model.js';
import { renderMarkdown } from './markdown.js';
import { KernelSession, kernelsAvailable } from './kernel-client.js';
import { chainAt } from '../learn/chain.js';
import { renderLens, askKernel } from '../learn/lens-ui.js';

const ICONS = {
  run: '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>',
  edit: '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 10l.5-2.3L8.3 1.9a1 1 0 0 1 1.4 0l.4.4a1 1 0 0 1 0 1.4L4.3 9.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  runAll: '<svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1.5 1.8v8.4L7 6zM7 1.8v8.4L12.5 6z" fill="currentColor"/></svg>',
  stop: '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><rect x="1.5" y="1.5" width="8" height="8" rx="1" fill="currentColor"/></svg>',
  restart: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M10.6 4.2A4.6 4.6 0 1 0 11 7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 1.6v3H8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clear: '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2 3.5h9M5 3.5V2h3v1.5M3.3 3.5l.6 7.5h5.2l.6-7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  up: '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M2 7l3.5-3.5L9 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M2 4l3.5 3.5L9 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  trash: '<svg width="11" height="11" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2 3.5h9M5 3.5V2h3v1.5M3.3 3.5l.6 7.5h5.2l.6-7.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  return e;
};

const button = (cls, label, icon, text = '') => {
  const b = el('button', cls, { type: 'button', title: label, 'aria-label': label });
  b.innerHTML = icon + (text ? `<span>${text}</span>` : '');
  return b;
};

/** UTF-8 text → base64 (SVG pictures go into an <img> as a data: URL, so their scripts never run). */
const base64Text = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

let runCounter = 0;

/** Where in the cell an error happened: the last "<cell n>" frame and its code line. */
export function errorLocation(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /File "<cell \d+>", line (\d+)/.exec(lines[i]);
    if (m) {
      const code = (lines[i + 1] || '').trim();
      return code && !code.startsWith('File ') ? { line: Number(m[1]), code } : { line: Number(m[1]), code: '' };
    }
  }
  return null;
}

export class NotebookView {
  /**
   * @param {object} opts
   * @param {string} opts.text            the .ipynb text ('' for a new notebook)
   * @param {() => string|null} opts.filePath  where the notebook is saved (kernel working folder)
   * @param {() => void} opts.onDirty     the user changed something
   * @param {(msg: string, kind?: string) => void} [opts.notify]
   */
  constructor({ text, filePath, onDirty, notify = () => {} }) {
    this.filePath = filePath;
    this.onDirty = onDirty;
    this.notify = notify;
    this.nb = parseNotebook(text);
    this.cellViews = new Map(); // cell id -> { root, editor, outputs, gutter, md, untrack }
    this.selected = this.nb.cells[0]?.id ?? null;
    this.queue = []; // { runId, cellId } waiting; queue[0] runs when running is set
    this.running = null; // { runId, cellId }
    this.kernelState = 'off'; // off | starting | idle | busy | dead
    this.kernel = null;
    this.pendingDelete = 0;
    this.lensListeners = new Set();
    this.build();
  }

  // ── Building ─────────────────────────────────────────────────────

  build() {
    this.el = el('div', 'nb', { role: 'region', 'aria-label': 'Notebook' });
    const bar = el('div', 'nb-bar', { role: 'toolbar', 'aria-label': 'Notebook' });
    this.$runAll = button('nb-btn nb-btn--primary', 'Run all cells', ICONS.runAll, 'Run all');
    this.$interrupt = button('nb-btn', 'Stop the running cell', ICONS.stop, 'Stop');
    this.$restart = button('nb-btn', 'Restart the kernel (clears all variables)', ICONS.restart, 'Restart');
    this.$clear = button('nb-btn', 'Clear every output', ICONS.clear, 'Clear outputs');
    this.$addCode = button('nb-btn nb-btn--text', 'Add a code cell below', '', '+ Code');
    this.$addMd = button('nb-btn nb-btn--text', 'Add a text (Markdown) cell below', '', '+ Text');
    this.$status = el('div', 'nb-kernel', { role: 'status', 'aria-live': 'polite' });
    this.$runAll.addEventListener('click', () => this.runAll());
    this.$interrupt.addEventListener('click', () => this.interrupt());
    this.$restart.addEventListener('click', () => this.restart());
    this.$clear.addEventListener('click', () => this.clearOutputs());
    this.$addCode.addEventListener('click', () => this.insertCell('code', 'below', true));
    this.$addMd.addEventListener('click', () => this.insertCell('markdown', 'below', true));
    const sep = () => el('span', 'nb-bar__sep', { 'aria-hidden': 'true' });
    bar.append(this.$runAll, this.$interrupt, this.$restart, sep(), this.$clear, sep(), this.$addCode, this.$addMd, el('span', 'nb-bar__fill'), this.$status);

    this.$cells = el('div', 'nb-cells');
    this.$scroll = el('div', 'nb-scroll');
    this.$scroll.append(this.$cells, this.addRow(null));
    this.el.append(bar, this.$scroll);
    this.el.addEventListener('keydown', (e) => this.commandKey(e));
    this.renderCells();
    this.updateStatus();
  }

  /** "+ Code  + Text" between cells (after the cell `afterId`, or at the end). */
  addRow(afterId) {
    const row = el('div', 'nb-add');
    const code = el('button', 'nb-add__btn', { type: 'button', text: '+ Code' });
    const md = el('button', 'nb-add__btn', { type: 'button', text: '+ Text' });
    const at = () => (afterId ? this.indexOf(afterId) + 1 : this.nb.cells.length);
    code.addEventListener('click', () => this.insertAt(at(), 'code', true));
    md.addEventListener('click', () => this.insertAt(at(), 'markdown', true));
    row.append(code, md);
    return row;
  }

  renderCells() {
    for (const v of this.cellViews.values()) this.destroyCellView(v);
    this.cellViews.clear();
    this.$cells.replaceChildren();
    for (const cell of this.nb.cells) this.$cells.append(this.cellView(cell).root);
    this.markSelected();
  }

  cellView(cell) {
    const root = el('div', `nb-cell nb-cell--${cell.type}`, { tabindex: '-1', 'data-cell': cell.id });
    const gutter = el('div', 'nb-cell__gutter');
    const main = el('div', 'nb-cell__main');
    const editorHost = el('div', 'nb-cell__editor');
    const md = el('div', 'nb-cell__md nb-md');
    const outputs = el('div', 'nb-cell__outputs', { 'aria-live': 'polite' });
    const tools = el('div', 'nb-cell__tools');

    // Code cells get a Run button; text cells none (they show formatted when you click away)
    let run = null;
    if (cell.type === 'code') {
      run = button('nb-cell__run', 'Run this cell (Ctrl+Enter)', ICONS.run);
      run.addEventListener('click', (e) => { e.stopPropagation(); this.select(cell.id); this.runCell(cell.id); });
      gutter.append(run);
    }
    const count = el('div', 'nb-cell__count', cell.type === 'markdown' ? { text: 'Text' } : {});
    gutter.append(count);

    const type = el('button', 'nb-tool nb-tool--type', { type: 'button', title: cell.type === 'code' ? 'Make this a text cell (M)' : 'Make this a code cell (Y)', text: cell.type === 'code' ? 'Py' : 'Md' });
    type.addEventListener('click', (e) => { e.stopPropagation(); this.setType(cell.id, cell.type === 'code' ? 'markdown' : 'code'); });
    const up = button('nb-tool', 'Move up', ICONS.up);
    up.addEventListener('click', (e) => { e.stopPropagation(); this.moveCell(cell.id, -1); });
    const down = button('nb-tool', 'Move down', ICONS.down);
    down.addEventListener('click', (e) => { e.stopPropagation(); this.moveCell(cell.id, 1); });
    const del = button('nb-tool nb-tool--del', 'Delete cell', ICONS.trash);
    del.addEventListener('click', (e) => { e.stopPropagation(); this.deleteCell(cell.id); });
    if (cell.type === 'code') {
      const lens = el('button', 'nb-tool nb-tool--lens', { type: 'button', title: 'Chain Lens: see the data after each step of the chain under the cursor', text: 'Lens' });
      lens.addEventListener('click', (e) => { e.stopPropagation(); this.select(cell.id); this.lensCell(cell.id); });
      tools.append(lens);
    }
    if (cell.type === 'markdown') {
      const edit = button('nb-tool nb-tool--edit', 'Edit this text (or double-click it)', ICONS.edit);
      edit.addEventListener('click', (e) => { e.stopPropagation(); this.select(cell.id); this.editMarkdown(cell.id); });
      tools.append(edit);
    }
    tools.append(type, up, down, del);

    main.append(editorHost, md, outputs);
    root.append(gutter, main, tools, this.addRow(cell.id));

    const editor = new EditorView({
      parent: editorHost,
      state: EditorState.create({ doc: cell.source, extensions: this.editorExtensions(cell) }),
    });
    const untrack = trackCellView(editor);
    const view = { root, editor, outputs, count, md, run, untrack, editing: false };
    this.cellViews.set(cell.id, view);

    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('.nb-add, .nb-cell__tools')) return;
      if (!e.target.closest('.cm-editor')) {
        this.select(cell.id);
        if (!e.target.closest('.nb-cell__outputs a, .nb-input')) setTimeout(() => { if (!view.editing) root.focus({ preventScroll: true }); });
      }
    });
    md.addEventListener('dblclick', () => this.editMarkdown(cell.id));
    if (cell.type === 'markdown') this.showMarkdown(cell, view, !!cell.source.trim());
    this.renderOutputs(cell);
    this.renderCount(cell);
    return view;
  }

  editorExtensions(cell) {
    const runKeys = Prec.highest(EditorView.domEventHandlers({
      keydown: (e) => {
        const plainEnter = e.key === 'Enter' && !e.metaKey;
        let handled = true;
        if (plainEnter && e.shiftKey && !e.ctrlKey && !e.altKey) this.runCell(cell.id, { advance: true });
        else if (plainEnter && e.ctrlKey && !e.shiftKey && !e.altKey) this.runCell(cell.id);
        else if (plainEnter && e.altKey && !e.ctrlKey && !e.shiftKey) this.runCell(cell.id, { insert: true });
        else if (e.key === 'Escape' && !document.querySelector('.cm-tooltip-autocomplete')) this.commandMode(cell.id);
        else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
        return handled;
      },
    }));
    return [
      runKeys,
      highlightSpecialChars(), history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
      cell.type === 'code' ? python() : EditorView.lineWrapping,
      placeholder(cell.type === 'code' ? 'Write Python here, then press Shift+Enter' : 'Write notes in Markdown: # Heading, **bold**, - list'),
      cellEditorExtensions({ completions: cell.type === 'code' }), // no Python suggestions while writing notes
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          cell.source = u.state.doc.toString();
          this.dirty();
        }
        if (u.focusChanged && u.view.hasFocus) {
          this.select(cell.id);
          const v = this.cellViews.get(cell.id);
          if (v) v.editing = true;
          this.el.classList.add('nb--editing');
        } else if (u.focusChanged) {
          const v = this.cellViews.get(cell.id);
          if (v) v.editing = false;
          this.el.classList.remove('nb--editing');
          // Clicking away from a text cell shows it formatted (like Colab)
          if (v && cell.type === 'markdown' && cell.source.trim() && document.hasFocus()) this.showMarkdown(cell, v, true);
        }
      }),
    ];
  }

  destroyCellView(v) {
    v.untrack();
    v.editor.destroy();
  }

  // ── Markdown cells ───────────────────────────────────────────────

  showMarkdown(cell, view, rendered) {
    view.root.classList.toggle('nb-cell--rendered', rendered);
    if (rendered) view.md.innerHTML = sanitizeHTML(renderMarkdown(cell.source, { attachments: cell.attachments }), document, { notebook: true });
  }

  editMarkdown(id) {
    const cell = this.cell(id);
    const view = this.cellViews.get(id);
    if (!cell || cell.type !== 'markdown' || !view) return;
    this.showMarkdown(cell, view, false);
    view.editor.focus();
  }

  // ── Outputs ──────────────────────────────────────────────────────

  renderOutputs(cell) {
    const view = this.cellViews.get(cell.id);
    if (!view) return;
    const nodes = cell.outputs.map((o) => this.outputNode(o)).filter(Boolean);
    view.outputs.replaceChildren(...nodes);
    view.root.classList.toggle('nb-cell--has-output', nodes.length > 0);
  }

  outputNode(o) {
    if (o.output_type === 'stream') {
      return el('pre', `nb-out nb-out--stream${o.name === 'stderr' ? ' nb-out--stderr' : ''}`, { text: stripAnsi(o.text) });
    }
    if (o.output_type === 'error') return this.errorNode(o);
    const data = o.data || {};
    const mime = pickMime(data);
    if (!mime) return null;
    const wrap = el('div', `nb-out nb-out--rich${o.output_type === 'execute_result' ? ' nb-out--result' : ''}`);
    const value = data[mime];
    const textFallback = () => el('pre', 'nb-out__text', { text: stripAnsi(String(data['text/plain'] ?? '')) });
    switch (mime) {
      case 'text/html': {
        const clean = sanitizeHTML(String(value), document, { notebook: true });
        if (clean.replace(/<[^>]*>/g, '').trim() || /<img/i.test(clean)) {
          const html = el('div', 'nb-out__html');
          html.innerHTML = clean;
          wrap.append(html);
        } else {
          wrap.append(textFallback());
        }
        break;
      }
      case 'image/svg+xml':
        wrap.append(el('img', 'nb-out__img', { alt: 'Picture output', src: `data:image/svg+xml;base64,${base64Text(String(value))}` }));
        break;
      case 'image/png': case 'image/jpeg': case 'image/gif':
        wrap.append(el('img', 'nb-out__img', { alt: String(data['text/plain'] ?? 'Plot'), src: `data:${mime};base64,${String(value).replace(/\s/g, '')}` }));
        break;
      case 'text/markdown': {
        const md = el('div', 'nb-md');
        md.innerHTML = sanitizeHTML(renderMarkdown(String(value)), document, { notebook: true });
        wrap.append(md);
        break;
      }
      case 'application/json':
        wrap.append(el('pre', 'nb-out__text', { text: JSON.stringify(value, null, 2) }));
        break;
      default:
        wrap.append(el('pre', 'nb-out__text', { text: stripAnsi(String(value)) }));
    }
    return wrap;
  }

  /**
   * An error: the message, the line of this cell where it happened, and the
   * full traceback (folded when it is long, e.g. deep inside a library).
   */
  errorNode(o) {
    const box = el('div', 'nb-out nb-out--error');
    const head = `${o.ename}${o.evalue ? `: ${o.evalue}` : ''}`;
    box.append(el('div', 'nb-out__ename', { text: head }));
    const tb = stripAnsi(o.traceback.join('\n')).replace(/\s+$/, '');
    const lines = tb.split('\n');
    const where = errorLocation(lines);
    if (where) {
      const row = el('div', 'nb-out__where');
      row.append(el('span', 'nb-out__where-label', { text: `Line ${where.line}` }), el('code', '', { text: where.code }));
      box.append(row);
    }
    if (tb.trim() && tb.trim() !== head) {
      const pre = el('pre', 'nb-out__tb', { text: tb });
      if (lines.length <= 10) box.append(pre);
      else {
        const more = el('details', 'nb-out__more');
        more.append(el('summary', '', { text: `Full traceback (${lines.length} lines)` }), pre);
        box.append(more);
      }
    }
    return box;
  }

  renderCount(cell) {
    const view = this.cellViews.get(cell.id);
    if (!view || cell.type !== 'code') return;
    const running = this.running?.cellId === cell.id;
    const queued = this.queue.some((q) => q.cellId === cell.id);
    view.root.classList.toggle('nb-cell--running', running);
    view.root.classList.toggle('nb-cell--queued', queued);
    view.count.textContent = running ? '[*]' : queued ? '[ ]' : cell.count != null ? `[${cell.count}]` : '';
    view.count.title = running ? 'Running' : queued ? 'Waiting to run' : cell.count != null ? `Run #${cell.count}` : 'Not run yet';
  }

  // ── Selection and command mode ───────────────────────────────────

  cell(id) { return this.nb.cells.find((c) => c.id === id) || null; }
  indexOf(id) { return this.nb.cells.findIndex((c) => c.id === id); }

  select(id) {
    if (!this.cell(id) || this.selected === id) return;
    this.selected = id;
    this.pendingDelete = 0;
    this.markSelected();
  }

  markSelected() {
    for (const [id, v] of this.cellViews) v.root.classList.toggle('nb-cell--selected', id === this.selected);
  }

  /** Leave the cell's editor; keys now act on cells. A Markdown cell shows its text. */
  commandMode(id = this.selected) {
    const cell = this.cell(id);
    const view = this.cellViews.get(id);
    if (!view) return;
    if (cell?.type === 'markdown' && cell.source.trim()) this.showMarkdown(cell, view, true);
    view.root.focus({ preventScroll: true });
  }

  /** Edit the cell (Enter in command mode). */
  editCell(id = this.selected) {
    const cell = this.cell(id);
    const view = this.cellViews.get(id);
    if (!cell || !view) return;
    if (cell.type === 'markdown') this.showMarkdown(cell, view, false);
    view.editor.focus();
    view.root.scrollIntoView({ block: 'nearest' });
  }

  selectAndShow(id, edit = false) {
    this.select(id);
    const view = this.cellViews.get(id);
    if (!view) return;
    if (edit) this.editCell(id);
    else { view.root.focus({ preventScroll: true }); view.root.scrollIntoView({ block: 'nearest' }); }
  }

  commandKey(e) {
    if (e.target.closest?.('.cm-editor, input, textarea') || e.ctrlKey || e.metaKey) {
      // Ctrl+Enter / Shift+Enter on a selected cell (not editing) still run it
      if (!(e.key === 'Enter' && e.ctrlKey && !e.target.closest?.('.cm-editor, input, textarea'))) return;
    }
    const id = this.selected;
    if (!id) return;
    const idx = this.indexOf(id);
    const key = e.key;
    let handled = true;
    if (key === 'Enter' && e.shiftKey) this.runCell(id, { advance: true });
    else if (key === 'Enter' && e.ctrlKey) this.runCell(id);
    else if (key === 'Enter' && e.altKey) this.runCell(id, { insert: true });
    else if (key === 'Enter') this.editCell(id);
    else if (key === 'ArrowUp' && e.shiftKey) this.moveCell(id, -1);
    else if (key === 'ArrowDown' && e.shiftKey) this.moveCell(id, 1);
    else if (key === 'ArrowUp' || key === 'k') { if (idx > 0) this.selectAndShow(this.nb.cells[idx - 1].id); }
    else if (key === 'ArrowDown' || key === 'j') { if (idx < this.nb.cells.length - 1) this.selectAndShow(this.nb.cells[idx + 1].id); }
    else if (key === 'a') this.insertCell('code', 'above', false);
    else if (key === 'b') this.insertCell('code', 'below', false);
    else if (key === 'm') this.setType(id, 'markdown');
    else if (key === 'y') this.setType(id, 'code');
    else if (key === 'd') {
      if (this.pendingDelete && Date.now() - this.pendingDelete < 800) { this.pendingDelete = 0; this.deleteCell(id); }
      else this.pendingDelete = Date.now();
    } else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  // ── Editing the cell list ────────────────────────────────────────

  insertCell(type, where, edit) {
    const idx = this.selected ? this.indexOf(this.selected) : this.nb.cells.length - 1;
    this.insertAt(where === 'above' ? Math.max(0, idx) : idx + 1, type, edit);
  }

  insertAt(index, type, edit = true) {
    const cell = newCell(type);
    this.nb.cells.splice(index, 0, cell);
    const view = this.cellView(cell);
    this.$cells.insertBefore(view.root, this.$cells.children[index] || null);
    this.select(cell.id);
    this.markSelected();
    this.dirty();
    this.selectAndShow(cell.id, edit);
    return cell;
  }

  deleteCell(id) {
    const idx = this.indexOf(id);
    if (idx < 0) return;
    if (this.running?.cellId === id || this.queue.some((q) => q.cellId === id)) {
      this.notify('Stop the cell before deleting it', 'info');
      return;
    }
    const [cell] = this.nb.cells.splice(idx, 1);
    const view = this.cellViews.get(cell.id);
    if (view) { view.root.remove(); this.destroyCellView(view); this.cellViews.delete(cell.id); }
    if (!this.nb.cells.length) {
      this.insertAt(0, 'code', false);
    } else {
      const next = this.nb.cells[Math.min(idx, this.nb.cells.length - 1)];
      this.selected = null;
      this.selectAndShow(next.id);
    }
    this.dirty();
  }

  moveCell(id, delta) {
    const idx = this.indexOf(id);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= this.nb.cells.length) return;
    const [cell] = this.nb.cells.splice(idx, 1);
    this.nb.cells.splice(to, 0, cell);
    const root = this.cellViews.get(id).root;
    this.reorderDom();
    root.focus({ preventScroll: true });
    root.scrollIntoView({ block: 'nearest' });
    this.dirty();
  }

  /** Make the DOM order match the cell list exactly. */
  reorderDom() {
    this.nb.cells.forEach((c, i) => {
      const root = this.cellViews.get(c.id)?.root;
      if (root && this.$cells.children[i] !== root) this.$cells.insertBefore(root, this.$cells.children[i] || null);
    });
  }

  setType(id, type) {
    const idx = this.indexOf(id);
    const cell = this.nb.cells[idx];
    if (!cell || cell.type === type) return;
    if (this.running?.cellId === id || this.queue.some((q) => q.cellId === id)) return;
    cell.type = type;
    cell.outputs = [];
    cell.count = null;
    const old = this.cellViews.get(id);
    const view = this.cellView(cell);
    old.root.replaceWith(view.root);
    this.destroyCellView(old);
    this.markSelected();
    view.root.focus({ preventScroll: true });
    this.dirty();
  }

  clearOutputs() {
    for (const cell of this.nb.cells) {
      if (cell.type !== 'code' || (!cell.outputs.length && cell.count == null)) continue;
      if (this.running?.cellId === cell.id) continue;
      cell.outputs = [];
      cell.count = null;
      this.renderOutputs(cell);
      this.renderCount(cell);
    }
    this.dirty();
  }

  dirty() { this.onDirty?.(); }

  // ── Running ──────────────────────────────────────────────────────

  async ensureKernel() {
    if (this.kernel?.info && this.kernelState !== 'dead') return true;
    if (!kernelsAvailable()) {
      this.notify('Notebooks need the desktop app with Python', 'info');
      return false;
    }
    if (!this.kernel) {
      this.kernel = new KernelSession({ onMessage: (m) => this.onKernelMessage(m), onExit: () => this.onKernelExit() });
    }
    this.setKernelState('starting');
    try {
      await (this.kernelState === 'dead' ? this.kernel.restart(this.filePath()) : this.kernel.start(this.filePath()));
      this.setKernelState('idle');
      return true;
    } catch (err) {
      this.setKernelState('off');
      this.notify(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
      return false;
    }
  }

  /**
   * Run a cell. Markdown cells just show their text.
   * @param {object} [opts]
   * @param {boolean} [opts.advance]  then go to the next cell (adding one at the end)
   * @param {boolean} [opts.insert]   then add a new cell below
   */
  runCell(id = this.selected, { advance = false, insert = false } = {}) {
    const cell = this.cell(id);
    if (!cell) return;
    if (cell.type === 'markdown') {
      const view = this.cellViews.get(id);
      if (view) this.showMarkdown(cell, view, !!cell.source.trim());
    } else if (cell.type === 'code') {
      this.enqueue([cell]);
    }
    const idx = this.indexOf(id);
    if (insert) this.insertAt(idx + 1, 'code', true);
    else if (advance) {
      const next = this.nb.cells[idx + 1];
      if (next) this.selectAndShow(next.id, next.type === 'code');
      else this.insertAt(idx + 1, 'code', true);
    } else if (cell.type === 'markdown') this.commandMode(id);
  }

  runAll() {
    for (const c of this.nb.cells) {
      if (c.type === 'markdown') {
        const view = this.cellViews.get(c.id);
        if (view && c.source.trim()) this.showMarkdown(c, view, true);
      }
    }
    this.enqueue(this.nb.cells.filter((c) => c.type === 'code'));
  }

  /** Run every code cell above the selected one, then it. */
  runUpTo(id = this.selected) {
    const idx = this.indexOf(id);
    this.enqueue(this.nb.cells.slice(0, idx + 1).filter((c) => c.type === 'code'));
  }

  enqueue(cells) {
    for (const cell of cells) {
      if (!cell.source.trim()) continue;
      if (this.running?.cellId === cell.id || this.queue.some((q) => q.cellId === cell.id)) continue;
      this.queue.push({ runId: `r${++runCounter}`, cellId: cell.id });
      this.renderCount(cell);
    }
    this.pump();
  }

  async pump() {
    if (this.running || this.pumping || !this.queue.length) return;
    this.pumping = true;
    try {
      if (!(await this.ensureKernel())) {
        this.dropQueue();
        return;
      }
      const next = this.queue.shift();
      const cell = next && this.cell(next.cellId);
      if (!cell) { this.pumping = false; this.pump(); return; }
      this.running = next;
      cell.outputs = [];
      this.renderOutputs(cell);
      this.renderCount(cell);
      this.setKernelState('busy');
      this.dirty();
      try {
        const sent = await this.kernel.execute(next.runId, cell.source);
        if (sent === false) throw new Error('The kernel is not running.');
      } catch (err) {
        this.running = null;
        addMessage(cell.outputs, { type: 'error', ename: 'KernelError', evalue: String(err?.message || err), traceback: '' });
        this.renderOutputs(cell);
        this.renderCount(cell);
        this.dropQueue();
        this.setKernelState(this.kernel?.info ? 'idle' : 'off');
      }
    } finally {
      this.pumping = false;
    }
  }

  dropQueue() {
    const dropped = this.queue.splice(0);
    for (const q of dropped) { const c = this.cell(q.cellId); if (c) this.renderCount(c); }
  }

  onKernelMessage(msg) {
    if (msg.type === 'lens-result') { this.lensListeners.forEach((fn) => fn(msg)); return; }
    const run = this.running;
    if (!run || msg.id !== run.runId) {
      // Output from a background thread after its cell finished: show it under the last cell that ran
      if (msg.type === 'stream' && this.lastRun) {
        const cell = this.cell(this.lastRun.cellId);
        if (cell && addMessage(cell.outputs, msg)) this.renderOutputs(cell);
      }
      return;
    }
    const cell = this.cell(run.cellId);
    if (msg.type === 'input_request') {
      this.askInput(cell, msg.prompt);
      return;
    }
    if (msg.type === 'done') {
      this.running = null;
      this.lastRun = run;
      this.removeInput(cell);
      if (cell) {
        if (Number.isInteger(msg.count)) cell.count = msg.count;
        this.renderCount(cell);
      }
      if (msg.died) {
        if (cell) {
          addMessage(cell.outputs, { type: 'error', ename: 'KernelDied', evalue: 'Python stopped while running this cell (it may have run out of memory or crashed). Your variables are gone; run the cells again.', traceback: '' });
          this.renderOutputs(cell);
        }
        this.dropQueue();
        this.setKernelState('dead');
        return;
      }
      if (msg.status === 'error') this.dropQueue(); // like Jupyter: stop at the first error
      this.setKernelState(this.queue.length ? 'busy' : 'idle');
      this.dirty();
      this.pump();
      return;
    }
    if (cell && addMessage(cell.outputs, msg)) this.renderOutputs(cell);
  }

  onKernelExit() {
    if (this.kernelState === 'off' || this.restarting) return;
    this.running = null;
    this.dropQueue();
    this.setKernelState('dead');
  }

  /** A text box under the cell for input(). */
  askInput(cell, prompt) {
    const view = cell && this.cellViews.get(cell.id);
    if (!view) return;
    this.removeInput(cell);
    const row = el('div', 'nb-input');
    row.append(el('span', 'nb-input__prompt', { text: prompt || 'Input:' }));
    const box = el('input', 'nb-input__box', { type: 'text', spellcheck: 'false', 'aria-label': prompt || 'Input for the program' });
    const sendIt = () => {
      this.kernel?.input(box.value);
      row.remove();
      if (view.inputRow === row) view.inputRow = null;
    };
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        sendIt();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
      }
    });
    const send = el('button', 'nb-btn nb-input__send', { type: 'button', text: 'Send', title: 'Send this to the program (Enter)' });
    send.addEventListener('click', (e) => { e.preventDefault(); sendIt(); });
    row.append(box, send);
    view.outputs.after(row);
    view.inputRow = row;
    box.focus();
  }

  removeInput(cell) {
    const view = cell && this.cellViews.get(cell.id);
    view?.inputRow?.remove();
    if (view) view.inputRow = null;
  }

  interrupt() {
    if (!this.kernel) return;
    this.dropQueue();
    if (this.running) this.kernel.interrupt();
  }

  async restart() {
    if (!kernelsAvailable()) { this.notify('Notebooks need the desktop app with Python', 'info'); return; }
    if (!this.kernel?.info && this.kernelState !== 'dead') {
      // Nothing running yet: start fresh
      await this.ensureKernel();
      return;
    }
    const run = this.running;
    this.dropQueue();
    this.running = null;
    if (run) { const c = this.cell(run.cellId); this.removeInput(c); if (c) this.renderCount(c); }
    this.restarting = true;
    this.setKernelState('starting');
    try {
      await this.kernel.restart(this.filePath());
      this.setKernelState('idle');
      this.notify('Kernel restarted: all variables were cleared', 'info');
    } catch (err) {
      this.setKernelState('off');
      this.notify(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    } finally {
      this.restarting = false;
    }
  }

  setKernelState(s) {
    this.kernelState = s;
    this.updateStatus();
  }

  updateStatus() {
    const s = this.kernelState;
    const py = this.kernel?.info?.python ? `Python ${this.kernel.info.python}` : 'Python';
    const text = {
      off: 'starts when you run a cell',
      starting: 'starting…',
      idle: 'ready',
      busy: 'running',
      dead: 'stopped: run a cell to start again',
    }[s];
    this.$status.textContent = '';
    this.$status.append(
      el('span', `nb-kernel__dot nb-kernel__dot--${s}`, { 'aria-hidden': 'true' }),
      el('span', 'nb-kernel__py', { text: `${py} · ` }),
      el('span', '', { text }),
    );
    this.$status.title = this.kernel?.info?.executable || 'The notebook runs on the Python chosen in the status bar';
    this.el.dataset.kernel = s;
    this.$interrupt.disabled = s !== 'busy';
  }

  // ── Chain Lens ───────────────────────────────────────────────────

  /** The data after each step of the chain under the cursor, using this notebook's variables. */
  async lensCell(id = this.selected) {
    const cell = this.cell(id);
    const view = this.cellViews.get(id);
    if (!cell || cell.type !== 'code' || !view) return;
    const line = view.editor.state.doc.lineAt(view.editor.state.selection.main.head).number;
    const at = chainAt(cell.source, line);
    if (!at) { this.notify('Put the cursor on a chain like df.dropna().groupby("x").mean()', 'info'); return; }
    if (!this.kernel?.info || this.kernelState === 'dead') {
      this.notify('Run the cells that create your data first, then use the Lens', 'info');
      return;
    }
    view.lens?.remove();
    const panel = el('div', 'nb-lens');
    view.lens = panel;
    panel.append(el('div', 'lens__note', { text: 'Looking at each step…' }));
    view.outputs.before(panel);
    const res = await askKernel(this.kernel, at.steps, (fn) => { this.lensListeners.add(fn); return () => this.lensListeners.delete(fn); });
    if (!panel.isConnected) return;
    renderLens(panel, { ...res, expr: at.expr }, () => { panel.remove(); view.lens = null; });
  }

  // ── Tab life cycle ───────────────────────────────────────────────

  /** The notebook as .ipynb text. */
  serialize() {
    return serializeNotebook(this.nb, { pythonVersion: this.kernel?.info?.python });
  }

  /** The file changed on disk: show the new contents (keeps the kernel). */
  load(text) {
    this.nb = parseNotebook(text);
    this.selected = this.nb.cells[0]?.id ?? null;
    this.dropQueue();
    this.renderCells();
  }

  mount(container) {
    if (this.el.parentElement !== container) container.append(this.el);
    for (const v of this.cellViews.values()) v.editor.requestMeasure();
  }

  unmount() { this.el.remove(); }

  focus() {
    const id = this.selected || this.nb.cells[0]?.id;
    if (!id) return;
    const view = this.cellViews.get(id);
    if (view?.editing) view.editor.focus();
    else view?.root.focus({ preventScroll: true });
  }

  dispose() {
    for (const v of this.cellViews.values()) this.destroyCellView(v);
    this.cellViews.clear();
    this.kernel?.dispose();
    this.kernel = null;
    this.el.remove();
  }
}

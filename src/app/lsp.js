/**
 * Language intelligence (desktop): connects the editor to the Python
 * language server (basedpyright) running in the main process.
 *
 * From @codemirror/lsp-client: completions, hover, signature help, go to
 * definition and diagnostics sync. Built here, because they must work with
 * our tabs rather than one editor per file: the workspace (files stay open
 * on the server while their tab exists), Problems, Find References, Rename
 * across files, symbol search and formatting with Ruff.
 */
import {
  LSPClient, LSPPlugin, Workspace, serverCompletion, hoverTooltips, signatureHelp, serverDiagnostics, jumpToDefinition,
} from '@codemirror/lsp-client';
import { EditorView } from '@codemirror/view';
import { setDiagnostics } from '@codemirror/lint';
import { Text } from '@codemirror/state';
import { getView, setLanguageAssist, setLspExtension } from '../editor.js';
import { showToast } from '../toast.js';
import { $ } from '../core/dom.js';
import { pathToUri, uriToPath, uriKey, sameUri, untitledUri } from '../core/uri.js';
import { sanitizeHTML } from '../core/sanitize-html.js';
import { minimalChange, editsByUri } from '../core/text-edits.js';
import {
  getTabs, getActiveTab, onTabShow, onTabsChanged, switchTab, openLibraryTab, editTab, addBackgroundTab,
} from './tabs.js';
import { getWorkspaceRoot, isInWorkspace, onWorkspaceChange, onFilesChanged, openPath, relativePath } from './workspace.js';
import { openQuickPick, openInputBox } from './quick-pick.js';
import { setBeforeSave } from './files.js';
import { getPrefs, setPrefs } from './session.js';
import { state } from './state.js';

const api = () => window.electronAPI;
const SEVERITY = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
const SYMBOL_KIND = {
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method', 7: 'property', 8: 'field',
  9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function', 13: 'variable', 14: 'constant', 15: 'string',
  16: 'number', 17: 'boolean', 18: 'array', 19: 'object', 20: 'key', 21: 'null', 22: 'enum member',
  23: 'struct', 24: 'event', 25: 'operator', 26: 'type parameter',
};

let client = null;
let generation = 0;
let handlers = new Set();
let restarts = 0;
let ready = false;
const plugins = new Map(); // uriKey -> editor extension for that document
const diagnostics = new Map(); // uriKey -> { uri, items: LSP diagnostics }
const problemListeners = new Set();
const shownMessages = new Set();

export const isLanguageServerReady = () => ready;

// ── Positions ────────────────────────────────────────────────────

/** LSP {line, character} → offset in `doc` (clamped). */
export function fromPosition(doc, pos) {
  const line = doc.line(Math.max(1, Math.min(doc.lines, pos.line + 1)));
  return Math.min(line.to, line.from + Math.max(0, pos.character));
}

export function toPosition(doc, offset) {
  const line = doc.lineAt(offset);
  return { line: line.number - 1, character: offset - line.from };
}

// ── Which URI a tab has ──────────────────────────────────────────

export function tabUri(tab) {
  if (tab.libraryUri) return tab.libraryUri;
  if (tab.filePath) return pathToUri(tab.filePath);
  return untitledUri(tab.id, tab.name);
}

function pluginFor(uri) {
  const k = uriKey(uri);
  if (!plugins.has(k)) plugins.set(k, client.plugin(uri, 'python'));
  return plugins.get(k);
}

// ── Workspace: files stay open on the server while their tab exists ──

class TabWorkspace extends Workspace {
  constructor(c) {
    super(c);
    this.files = [];
    this.versions = new Map();
  }

  getFile(uri) {
    const k = uriKey(uri);
    return this.files.find((f) => uriKey(f.uri) === k) || null;
  }

  nextVersion(uri) {
    const k = uriKey(uri);
    const v = (this.versions.get(k) ?? -1) + 1;
    this.versions.set(k, v);
    return v;
  }

  syncFiles() {
    const result = [];
    for (const file of this.files) {
      const plugin = file.view && LSPPlugin.get(file.view);
      if (!plugin || plugin.uri !== file.uri) continue;
      const changes = plugin.unsyncedChanges;
      if (!changes.empty) {
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view.state.doc;
        file.version = this.nextVersion(file.uri);
        plugin.clear();
      }
    }
    return result;
  }

  openFile(uri, languageId, view) {
    let file = this.getFile(uri);
    if (file) {
      file.view = view;
      if (!file.doc.eq(view.state.doc)) {
        // Changed while hidden (rename, reload from disk): send the whole text
        file.doc = view.state.doc;
        file.version = this.nextVersion(uri);
        this.client.notification('textDocument/didChange', {
          textDocument: { uri: file.uri, version: file.version },
          contentChanges: [{ text: file.doc.toString() }],
        });
      }
      return;
    }
    file = { uri, languageId, version: this.nextVersion(uri), doc: view.state.doc, view, getView() { return this.view; } };
    this.files.push(file);
    this.client.didOpen(file);
  }

  closeFile(uri, view) {
    const file = this.getFile(uri);
    if (file && file.view === view) file.view = null;
  }

  /** The tab closed: close the document on the server. */
  forget(uri) {
    const file = this.getFile(uri);
    if (!file) return;
    this.files = this.files.filter((f) => f !== file);
    if (this.client.connected) this.client.didClose(file.uri);
    plugins.delete(uriKey(uri));
    if (diagnostics.delete(uriKey(uri))) emitProblems();
  }

  async displayFile(uri) {
    return openUri(uri);
  }
}

// ── Diagnostics & Problems ───────────────────────────────────────

function toCodeMirror(plugin, items, doc) {
  return items.map((d) => {
    const from = fromPosition(doc, d.range.start);
    const to = Math.max(from, fromPosition(doc, d.range.end));
    const tags = d.tags || [];
    return {
      from: plugin ? plugin.unsyncedChanges.mapPos(from) : from,
      to: plugin ? plugin.unsyncedChanges.mapPos(to) : to,
      severity: SEVERITY[d.severity || 1],
      message: d.message,
      source: d.code ? `${d.source || 'basedpyright'} · ${d.code}` : d.source,
      markClass: tags.includes(1) ? 'cm-lsp-unnecessary' : tags.includes(2) ? 'cm-lsp-deprecated' : undefined,
    };
  });
}

/** Show stored diagnostics for the document in the editor (if it is visible). */
function applyDiagnostics(uri) {
  const view = getView();
  const plugin = view && LSPPlugin.get(view);
  if (!plugin || !sameUri(plugin.uri, uri)) return;
  const entry = diagnostics.get(uriKey(uri));
  const doc = plugin.syncedDoc;
  view.dispatch(setDiagnostics(view.state, entry ? toCodeMirror(plugin, entry.items, doc) : []));
}

function onPublishDiagnostics(_client, params) {
  const file = client.workspace.getFile(params.uri);
  if (file && params.version != null && params.version !== file.version) return true; // stale
  if (params.diagnostics.length) diagnostics.set(uriKey(params.uri), { uri: file?.uri || params.uri, items: params.diagnostics });
  else diagnostics.delete(uriKey(params.uri));
  applyDiagnostics(params.uri);
  emitProblems();
  return true;
}

/** fn({ errors, warnings, files }) when problems change. */
export function onProblems(fn) { problemListeners.add(fn); return () => problemListeners.delete(fn); }

let problemsTimer = null;
function emitProblems() {
  clearTimeout(problemsTimer);
  problemsTimer = setTimeout(() => {
    const summary = problemSummary();
    renderProblems(summary);
    problemListeners.forEach((fn) => fn(summary));
  }, 60);
}

/** Problems that matter (errors, warnings, info), grouped by file, errors first. */
export function problemSummary() {
  let errors = 0;
  let warnings = 0;
  const files = [];
  for (const { uri, items } of diagnostics.values()) {
    const shown = items.filter((d) => (d.severity || 1) <= 3)
      .sort((a, b) => (a.severity || 1) - (b.severity || 1) || a.range.start.line - b.range.start.line);
    if (!shown.length) continue;
    errors += shown.filter((d) => (d.severity || 1) === 1).length;
    warnings += shown.filter((d) => d.severity === 2).length;
    files.push({ uri, name: displayName(uri), items: shown });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { errors, warnings, files };
}

function displayName(uri) {
  const tab = getTabs().find((t) => sameUri(tabUri(t), uri));
  if (tab && !tab.filePath) return tab.name;
  const p = uriToPath(uri);
  if (p && isInWorkspace(p)) return relativePath(p);
  return p ? p.split(/[\\/]/).pop() : uri;
}

function renderProblems({ errors, warnings, files }) {
  const $list = $('problems-list');
  const $count = $('problems-count');
  if ($count) {
    $count.textContent = errors + warnings ? String(errors + warnings) : '';
    $count.classList.toggle('has-errors', errors > 0);
  }
  const $status = $('status-problems');
  if ($status) {
    $status.querySelector('[data-errors]').textContent = String(errors);
    $status.querySelector('[data-warnings]').textContent = String(warnings);
    $status.classList.remove('hidden');
  }
  if (!$list) return;
  $list.textContent = '';
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'problems-empty';
    empty.textContent = ready ? 'No problems in open files.' : 'The language server is starting…';
    $list.appendChild(empty);
    return;
  }
  for (const file of files) {
    const head = document.createElement('div');
    head.className = 'problems-file';
    head.textContent = file.name;
    const n = document.createElement('span');
    n.className = 'problems-file__count';
    n.textContent = String(file.items.length);
    head.appendChild(n);
    $list.appendChild(head);
    for (const d of file.items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `problem problem--${SEVERITY[d.severity || 1]}`;
      const icon = document.createElement('span');
      icon.className = 'problem__icon';
      icon.setAttribute('aria-label', SEVERITY[d.severity || 1]);
      const msg = document.createElement('span');
      msg.className = 'problem__msg';
      msg.textContent = d.message.split('\n')[0];
      msg.title = d.message;
      const where = document.createElement('span');
      where.className = 'problem__where';
      where.textContent = `${d.code ? `${d.code} · ` : ''}Ln ${d.range.start.line + 1}, Col ${d.range.start.character + 1}`;
      row.append(icon, msg, where);
      row.addEventListener('click', () => openUri(file.uri, d.range.start, true));
      $list.appendChild(row);
    }
  }
}

// ── Opening documents ────────────────────────────────────────────

/**
 * Show the document at `uri` (a tab, a project file, or a library file
 * read-only), optionally with the cursor at an LSP position.
 * @returns {Promise<EditorView|null>}
 */
export async function openUri(uri, position, focus = false) {
  const tab = getTabs().find((t) => sameUri(tabUri(t), uri));
  if (tab) {
    switchTab(tab.id);
  } else {
    const path = uriToPath(uri);
    if (!path) return null;
    if (isInWorkspace(path)) {
      await openPath(path);
    } else {
      try {
        const { content } = await api().lspReadFile(uri);
        openLibraryTab(uri, path.split(/[\\/]/).pop(), content);
      } catch (err) {
        showToast(err.message || 'Could not open that file', 'error', 2600);
        return null;
      }
    }
  }
  const view = getView();
  if (position && view) {
    const pos = fromPosition(view.state.doc, position);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  }
  if (focus) view?.focus();
  return view;
}

// ── Commands ─────────────────────────────────────────────────────

/** The visible document's plugin, after pushing pending edits to the server. */
function current() {
  const view = getView();
  const plugin = view && LSPPlugin.get(view);
  if (!ready || !plugin) {
    showToast(ready ? 'Open a Python file first' : 'Language features need the desktop app with Python', 'info', 2200);
    return null;
  }
  client.sync();
  return { view, plugin, uri: plugin.uri, position: plugin.toPosition(view.state.selection.main.head) };
}

export function goToDefinition() {
  const view = getView();
  if (!current()) return;
  jumpToDefinition(view);
}

/** Text of one line of a document (open tab, project file, or library file). */
async function lineReader() {
  const cache = new Map();
  return async (uri, line) => {
    const k = uriKey(uri);
    if (!cache.has(k)) {
      const file = client.workspace.getFile(uri);
      let doc = file ? (file.view ? file.view.state.doc : file.doc) : null;
      if (!doc) {
        const path = uriToPath(uri);
        try {
          const text = path && isInWorkspace(path)
            ? (await api().wsRead(path)).value
            : (await api().lspReadFile(uri)).content;
          doc = Text.of(String(text ?? '').split(/\r?\n/));
        } catch (_) {
          doc = null;
        }
      }
      cache.set(k, doc);
    }
    const doc = cache.get(k);
    return doc && line < doc.lines ? doc.line(line + 1).text : '';
  };
}

export async function findReferences() {
  const cur = current();
  if (!cur) return;
  const word = wordAt(cur.view);
  let locs;
  try {
    locs = await client.request('textDocument/references', {
      textDocument: { uri: cur.uri }, position: cur.position, context: { includeDeclaration: true },
    });
  } catch (err) {
    return showToast(`Find references failed: ${err.message || err}`, 'error', 2600);
  }
  if (!locs?.length) return showToast(`No references to ${word || 'this'} found`, 'info', 2000);
  const read = await lineReader();
  const items = [];
  let lastFile = null;
  for (const loc of locs) {
    const name = displayName(loc.uri);
    if (name !== lastFile) { items.push({ separator: name }); lastFile = name; }
    const text = (await read(loc.uri, loc.range.start.line)).trim();
    items.push({
      label: text || '(empty line)',
      description: `Ln ${loc.range.start.line + 1}`,
      run: () => openUri(loc.uri, loc.range.start, true),
    });
  }
  openQuickPick({ title: `${locs.length} reference${locs.length === 1 ? '' : 's'} to ${word || 'symbol'}`, items });
}

function wordAt(view) {
  const range = view.state.wordAt(view.state.selection.main.head);
  return range ? view.state.sliceDoc(range.from, range.to) : '';
}

const IDENTIFIER = /^[A-Za-z_À-￿][\wÀ-￿]*$/;

export async function renameSymbol() {
  const cur = current();
  if (!cur) return;
  if (cur.view.state.readOnly) return showToast('Library files are read only', 'info', 2000);
  let placeholder = wordAt(cur.view);
  try {
    const prep = await client.request('textDocument/prepareRename', { textDocument: { uri: cur.uri }, position: cur.position });
    if (!prep) return showToast('This cannot be renamed', 'info', 2000);
    if (prep.placeholder) placeholder = prep.placeholder;
    else if (prep.start || prep.range) {
      const r = prep.range || prep;
      placeholder = cur.view.state.sliceDoc(fromPosition(cur.view.state.doc, r.start), fromPosition(cur.view.state.doc, r.end));
    }
  } catch (_) { /* server without prepareRename: use the word */ }
  if (!placeholder) return showToast('Put the cursor on a name to rename it', 'info', 2000);

  const newName = await openInputBox({
    title: `Rename ${placeholder}`,
    value: placeholder,
    validate: (v) => (!v.trim() ? 'Type a new name' : !IDENTIFIER.test(v.trim()) ? 'Not a valid Python name' : null),
  });
  if (newName === null || newName.trim() === placeholder) return;

  let edit;
  try {
    client.sync();
    edit = await client.request('textDocument/rename', { textDocument: { uri: cur.uri }, position: cur.position, newName: newName.trim() });
  } catch (err) {
    return showToast(`Rename failed: ${err.message || err}`, 'error', 2600);
  }
  const changed = await applyWorkspaceEdit(edit);
  if (changed.files) {
    showToast(`Renamed in ${changed.edits} place${changed.edits === 1 ? '' : 's'} across ${changed.files} file${changed.files === 1 ? '' : 's'}${changed.opened ? '. Review and save the opened files.' : ''}`, 'success', 3200);
  }
}

/**
 * Apply a rename's edits: open tabs are edited in place (undoable), project
 * files that are not open open in background tabs, unsaved, for review.
 * Library files are never changed.
 */
async function applyWorkspaceEdit(edit) {
  let files = 0;
  let edits = 0;
  let opened = 0;
  for (const { uri, edits: list } of editsByUri(edit).values()) {
    let tab = getTabs().find((t) => sameUri(tabUri(t), uri));
    if (!tab) {
      const path = uriToPath(uri);
      if (!path || !isInWorkspace(path)) continue;
      const res = await api().wsRead(path);
      if (!res?.ok) continue;
      tab = addBackgroundTab(path.split(/[\\/]/).pop(), res.value, path);
      opened += 1;
    }
    const ok = editTab(tab.id, (doc) => list.map((e) => ({
      from: fromPosition(doc, e.range.start), to: fromPosition(doc, e.range.end), insert: e.newText,
    })));
    if (ok) { files += 1; edits += list.length; }
  }
  return { files, edits, opened };
}

function flattenSymbols(symbols, depth = 0, container = '') {
  const out = [];
  for (const s of symbols || []) {
    const range = s.selectionRange || s.range || s.location?.range;
    out.push({ name: s.name, kind: s.kind, depth, container: s.containerName || container, range, uri: s.location?.uri });
    if (s.children) out.push(...flattenSymbols(s.children, depth + 1, s.name));
  }
  return out;
}

export async function goToSymbolInFile() {
  const cur = current();
  if (!cur) return;
  let symbols;
  try {
    symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri: cur.uri } });
  } catch (err) {
    return showToast(`Symbols failed: ${err.message || err}`, 'error', 2400);
  }
  const flat = flattenSymbols(symbols).filter((s) => s.kind !== 13 || s.depth === 0); // skip locals
  if (!flat.length) return showToast('No symbols in this file', 'info', 1800);
  openQuickPick({
    title: 'Go to symbol in file',
    items: flat.map((s) => ({
      label: `${'  '.repeat(s.depth)}${s.name}`,
      description: SYMBOL_KIND[s.kind] || '',
      run: () => openUri(cur.uri, s.range.start, true),
    })),
  });
}

export function goToSymbolInProject() {
  if (!ready) return showToast('Language features need the desktop app with Python', 'info', 2200);
  openQuickPick({
    title: 'Go to symbol in project (type a name)',
    emptyText: 'Type part of a function, class or variable name',
    load: async (query) => {
      if (!query) return [];
      const found = await client.request('workspace/symbol', { query });
      return (found || []).slice(0, 200).map((s) => ({
        label: s.name,
        description: `${SYMBOL_KIND[s.kind] || ''}${s.containerName ? ` · ${s.containerName}` : ''}`,
        detail: displayName(s.location.uri),
        run: () => openUri(s.location.uri, s.location.range?.start, true),
      }));
    },
  });
}

// ── Formatting (Ruff) ────────────────────────────────────────────

export async function formatDocument({ quiet = false } = {}) {
  const view = getView();
  const tab = getActiveTab();
  if (!view || !api()?.lspFormat) return false;
  if (tab?.readOnly) { if (!quiet) showToast('Library files are read only', 'info', 2000); return false; }
  const before = view.state.doc.toString();
  const res = await api().lspFormat(before, tab?.name || 'main.py');
  if (!res.ok) {
    if (!quiet) showToast(`Could not format: ${res.error.split('\n')[0]}`, 'error', 3200);
    return false;
  }
  if (view.state.doc.toString() !== before) return false; // edited meanwhile
  const change = minimalChange(before, res.code);
  if (change) view.dispatch({ changes: change, userEvent: 'input.format' });
  else if (!quiet) showToast('Already formatted', 'info', 1400);
  return true;
}

// ── Start-up ─────────────────────────────────────────────────────

function makeTransport(gen) {
  handlers = new Set();
  return {
    send(message) { api().lspSend(gen, message); },
    subscribe(h) { handlers.add(h); },
    unsubscribe(h) { handlers.delete(h); },
  };
}

async function connect() {
  ready = false;
  if (client.connected) client.disconnect();
  const { generation: gen, rootUri } = await api().lspStart();
  generation = gen;
  client.config.rootUri = rootUri || undefined;
  client.connect(makeTransport(gen));
  await client.initializing;
  ready = true;
  emitProblems();
}

/** Attach the visible tab's document to the language server. */
function attach(tab) {
  if (!client || !tab) return;
  setLspExtension(pluginFor(tabUri(tab)));
  applyDiagnostics(tabUri(tab));
}

/** Close documents whose tabs are gone; follow renamed files. */
function reconcile() {
  if (!client) return;
  const live = new Set(getTabs().map((t) => uriKey(tabUri(t))));
  for (const f of [...client.workspace.files]) if (!live.has(uriKey(f.uri))) client.workspace.forget(f.uri);
  const tab = getActiveTab();
  const plugin = getView() && LSPPlugin.get(getView());
  if (tab && plugin && !sameUri(plugin.uri, tabUri(tab))) attach(tab);
}

/**
 * Start language intelligence. Returns false (and the editor keeps its
 * built-in helpers) when there is no desktop app or no local Python.
 */
export async function initLanguageServer() {
  if (!api()?.lspStart || client) return false;
  client = new LSPClient({
    workspace: (c) => new TabWorkspace(c),
    timeout: 15000,
    sanitizeHTML: (html) => sanitizeHTML(html),
    notificationHandlers: {
      'textDocument/publishDiagnostics': onPublishDiagnostics,
      // Server messages become toasts (each one once), never a bar over the code
      'window/showMessage': (_c, { type, message }) => {
        const text = String(message || '').split('\n')[0].slice(0, 180);
        if (type <= 2 && text && !shownMessages.has(text)) {
          shownMessages.add(text);
          showToast(`Python language server: ${text}`, type === 1 ? 'error' : 'info', 4000);
        }
        return true;
      },
    },
    extensions: [
      serverCompletion(),
      hoverTooltips({ hoverTime: 350 }),
      signatureHelp(),
      serverDiagnostics(), // syncs edits to the server as you type
      EditorView.domEventHandlers({
        // Ctrl+click (Cmd+click) goes to the definition
        mousedown(e, view) {
          if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          view.dispatch({ selection: { anchor: pos } });
          jumpToDefinition(view);
          e.preventDefault();
          return true;
        },
      }),
    ],
  });

  api().onLspMessage((gen, json) => {
    if (gen === generation) handlers.forEach((h) => h(json));
  });
  api().onLspExit(async (gen) => {
    if (gen !== generation) return;
    ready = false;
    if (restarts >= 3) {
      showToast('The Python language server stopped. Use "Restart Language Server" to try again.', 'error', 5000);
      return;
    }
    restarts += 1;
    await connect().catch(() => {});
  });

  try {
    await connect();
  } catch (err) {
    console.error('[THETA] language server failed to start', err);
    client = null;
    return false;
  }
  await api().lspSettings({ typeChecking: getPrefs().typeChecking || 'standard' });

  setLanguageAssist('lsp');
  attach(getActiveTab());
  onTabShow(({ phase, tab }) => {
    if (phase === 'before') setLspExtension([]);
    else attach(tab);
  });
  onTabsChanged(reconcile);

  // Another folder: restart with the new root (project imports resolve from it)
  let root = getWorkspaceRoot();
  onWorkspaceChange(async ({ root: next }) => {
    if (next === root) return;
    root = next;
    restarts = 0;
    await connect().catch((err) => console.error('[THETA] language server restart failed', err));
  });
  onFilesChanged((paths) => {
    const changes = paths.filter((p) => /\.pyi?$/i.test(p)).map((p) => ({ uri: pathToUri(p), type: 2 }));
    if (ready && changes.length) client.notification('workspace/didChangeWatchedFiles', { changes });
  });

  setBeforeSave(async (_code, name) => {
    if (getPrefs().formatOnSave && /\.pyi?$/i.test(name || '')) await formatDocument({ quiet: true });
  });
  state.lsp = { ready: () => ready };
  return true;
}

export async function restartLanguageServer() {
  if (!client) return showToast('Language features need the desktop app with Python', 'info', 2200);
  restarts = 0;
  diagnostics.clear();
  emitProblems();
  await connect();
  attach(getActiveTab());
  showToast('Language server restarted', 'success', 1600);
}

/** Settings → type checking level. */
export async function setTypeChecking(level) {
  setPrefs({ typeChecking: level });
  if (client) await api().lspSettings({ typeChecking: level });
}

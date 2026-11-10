/**
 * Plugins, the app side: start each enabled plugin in its own sandboxed
 * worker, answer its requests (checking every one against the permissions
 * you allowed), send it the events it may see, and clean up everything it
 * added when it is turned off.
 */
import PluginWorker from './plugin-worker.js?worker&inline';
import { getValue, setValue, getView, getCursorPosition, onContentChange } from '../editor.js';
import { getActiveTab, getActiveFileName } from '../app/tabs.js';
import { openInputBox, openQuickPick } from '../app/quick-pick.js';
import { addCommand, removeCommand } from '../app/commands.js';
import { getWorkspaceRoot, openPath } from '../app/workspace.js';
import { onFileSaved } from '../app/files.js';
import { onRunFinish } from '../app/runtime.js';
import { sanitizeHTML } from '../core/sanitize-html.js';
import { showToast } from '../toast.js';
import { NEEDS, EVENT_NEEDS, safeRelative } from './plugin-rules.js';

export { NEEDS, EVENT_NEEDS, safeRelative };

const api = () => window.electronAPI;

const runtimes = new Map(); // id -> Runtime
const statusItems = new Map(); // `${pluginId}:${itemId}` -> { text, tooltip }

class Runtime {
  constructor({ manifest, code, granted }) {
    this.manifest = manifest;
    this.id = manifest.id;
    this.granted = new Set(granted);
    this.subscriptions = new Set();
    this.commands = new Map(); // full id -> { short, title }
    this.log = [];
    this.state = 'starting';
    this.error = null;
    this.toasts = [];
    this.worker = new PluginWorker();
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.fail(e.message || 'The plugin stopped with an error.');
    this.worker.postMessage({ t: 'init', code, info: { id: manifest.id, name: manifest.name, version: manifest.version, granted: [...this.granted] } });
  }

  addLog(text, kind = 'log') {
    this.log.push({ at: Date.now(), kind, text: String(text).slice(0, 4000) });
    if (this.log.length > 300) this.log.shift();
    changed();
  }

  fail(message) {
    this.error = message;
    this.addLog(message, 'error');
    changed();
  }

  async onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ready') { this.state = 'running'; changed(); return; }
    if (m.t === 'error') { this.fail(String(m.message || 'Error')); return; }
    if (m.t !== 'call' || !Number.isInteger(m.id) || typeof m.method !== 'string') return;
    const reply = (value, error) => this.worker?.postMessage({ t: 'reply', id: m.id, value, error });
    try {
      const need = NEEDS[m.method];
      if (need && !this.granted.has(need)) throw new Error(`This needs the "${need}" permission.`);
      const value = await this.handle(m.method, Array.isArray(m.args) ? m.args : []);
      reply(value === undefined ? null : value);
    } catch (err) {
      reply(undefined, String(err?.message || err));
    }
  }

  async handle(method, args) {
    const text = (v, n = 100_000) => String(v ?? '').slice(0, n);
    switch (method) {
      case 'commands.register': {
        const cmdId = text(args[0], 60).replace(/[^\w.-]/g, '');
        if (!cmdId) throw new Error('A command needs an id.');
        if (this.commands.size >= 30) throw new Error('A plugin can add at most 30 commands.');
        const full = `plugin:${this.id}:${cmdId}`;
        const title = text(args[1], 80) || cmdId;
        this.commands.set(full, { short: cmdId, title });
        addCommand({ id: full, name: `${this.manifest.name}: ${title}`, run: () => this.worker?.postMessage({ t: 'command', id: cmdId }) });
        changed();
        return true;
      }
      case 'events.subscribe': {
        const name = text(args[0], 40);
        const need = EVENT_NEEDS[name];
        if (!need) throw new Error(`Unknown event "${name}".`);
        if (!this.granted.has(need)) throw new Error(`Listening to ${name} needs the "${need}" permission.`);
        this.subscriptions.add(name);
        return true;
      }
      case 'window.showMessage': {
        // At most 5 messages in 10 seconds, so a plugin cannot flood the screen
        const now = Date.now();
        this.toasts = this.toasts.filter((t) => now - t < 10_000);
        if (this.toasts.length >= 5) return false;
        this.toasts.push(now);
        const kind = ['info', 'success', 'error'].includes(args[1]) ? args[1] : 'info';
        showToast(`${this.manifest.name}: ${text(args[0], 300)}`, kind, 3000);
        return true;
      }
      case 'window.showInput': {
        const o = args[0] || {};
        return openInputBox({ title: `${this.manifest.name}: ${text(o.title, 100)}`, value: text(o.value, 2000) });
      }
      case 'window.showQuickPick': {
        const items = (Array.isArray(args[0]) ? args[0] : []).slice(0, 500);
        return new Promise((resolve) => {
          openQuickPick({
            title: `${this.manifest.name}: ${text(args[1]?.title, 100) || 'Choose'}`,
            items: items.map((it, i) => ({ label: text(it.label, 200), description: text(it.description, 200), run: () => resolve({ index: i, label: text(it.label, 200) }) })),
            onCancel: () => resolve(null),
          });
        });
      }
      case 'statusBar.set': {
        const key = `${this.id}:${text(args[0], 40)}`;
        statusItems.set(key, { text: text(args[1], 60), tooltip: `${this.manifest.name}${args[2] ? `: ${text(args[2], 200)}` : ''}` });
        renderStatus();
        return true;
      }
      case 'statusBar.remove':
        statusItems.delete(`${this.id}:${text(args[0], 40)}`);
        renderStatus();
        return true;
      case 'log':
        this.addLog(text(args[0], 4000));
        return true;
      // Editor
      case 'editor.getText': return activeCode() ?? '';
      case 'editor.getSelection': {
        const v = codeView();
        if (!v) return '';
        const s = v.state.selection.main;
        return v.state.sliceDoc(s.from, s.to);
      }
      case 'editor.getFileName': return getActiveFileName();
      case 'editor.getCursor': { const c = getCursorPosition(); return { line: c.lineNumber, column: c.column }; }
      case 'editor.insertText': {
        const v = needCodeView();
        v.dispatch(v.state.replaceSelection(text(args[0])));
        return true;
      }
      case 'editor.replaceSelection': {
        const v = needCodeView();
        v.dispatch(v.state.replaceSelection(text(args[0])));
        return true;
      }
      case 'editor.setText':
        needCodeView();
        setValue(text(args[0], 2_000_000));
        return true;
      // Project files
      case 'workspace.root': return getWorkspaceRoot() ? (getWorkspaceRoot().split(/[\\/]/).pop() || '') : null;
      case 'workspace.readFile': {
        const res = await api().wsRead(absolute(args[0]));
        if (!res?.ok) throw new Error(res?.error || 'Could not read the file.');
        return res.value;
      }
      case 'workspace.listFiles': {
        const dir = args[0] ? absolute(args[0]) : getWorkspaceRoot();
        if (!dir) throw new Error('No project folder is open.');
        const res = await api().wsList(dir);
        if (!res?.ok) throw new Error(res?.error || 'Could not list the folder.');
        const root = getWorkspaceRoot();
        return res.value.map((e) => ({ name: e.name, type: e.type, path: e.path.slice(root.length + 1).replace(/\\/g, '/') }));
      }
      case 'workspace.writeFile': {
        const abs = absolute(args[0]);
        const rel = safeRelative(args[0]);
        const exists = await api().wsRead(abs);
        if (!exists?.ok) {
          const cut = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'));
          const made = await api().wsCreate(abs.slice(0, cut), abs.slice(cut + 1), 'file');
          if (!made?.ok) throw new Error(made?.error || `Could not create ${rel}.`);
        }
        const res = await api().saveFile(abs, text(args[1], 5_000_000));
        if (res?.error) throw new Error(res.error);
        this.addLog(`wrote ${rel}`, 'info');
        return true;
      }
      case 'workspace.openFile':
        await openPath(absolute(args[0]), Number.isInteger(args[1]) ? args[1] : undefined);
        return true;
      // Storage
      case 'storage.get': {
        const all = (await api().pluginsStorageGet(this.id)) || {};
        return all[text(args[0], 100)] ?? null;
      }
      case 'storage.set': {
        const all = (await api().pluginsStorageGet(this.id)) || {};
        all[text(args[0], 100)] = args[1] === undefined ? null : JSON.parse(JSON.stringify(args[1]));
        await api().pluginsStorageSet(this.id, all);
        return true;
      }
      // Panel
      case 'ui.showPanel': showPanel(this, args[0] || {}); return true;
      case 'ui.closePanel': closePanel(this.id); return true;
      default:
        throw new Error(`Unknown request ${method}.`);
    }
  }

  emit(name, data) {
    if (this.subscriptions.has(name)) this.worker?.postMessage({ t: 'event', name, data });
  }

  dispose() {
    try { this.worker?.terminate(); } catch (_) { /* gone */ }
    this.worker = null;
    for (const c of this.commands.keys()) removeCommand(c);
    this.commands.clear();
    for (const key of [...statusItems.keys()]) if (key.startsWith(`${this.id}:`)) statusItems.delete(key);
    renderStatus();
    closePanel(this.id);
    this.state = 'stopped';
  }
}

function absolute(rel) {
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No project folder is open.');
  const r = safeRelative(rel);
  if (!r) throw new Error('Use a path inside the project, like "data/scores.csv".');
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root}${sep}${r.split('/').join(sep)}`;
}

function codeView() { return getActiveTab()?.kind === 'notebook' ? null : getView(); }
function needCodeView() {
  const v = codeView();
  if (!v) throw new Error('Open a code file first.');
  if (getActiveTab()?.readOnly) throw new Error('This file is read-only.');
  return v;
}
function activeCode() { return codeView() ? getValue() : null; }

// ── Status bar items ───────────────────────────────────────────────

function statusBox(parent, cls) {
  let box = parent?.querySelector(`.${cls}`);
  if (parent && !box) {
    box = document.createElement('span');
    box.className = `plugin-status ${cls}`;
    const runtime = parent.querySelector('#runbar-runtime');
    if (runtime) parent.insertBefore(box, runtime); else parent.prepend(box);
  }
  return box;
}

function renderStatus() {
  for (const box of [statusBox(document.querySelector('.statusbar__right'), 'plugin-status--pro'), statusBox(document.querySelector('.ide-runbar'), 'plugin-status--play')]) {
    if (!box) continue;
    box.replaceChildren();
    for (const [, item] of statusItems) {
      const s = document.createElement('span');
      s.className = 'plugin-status__item';
      s.textContent = item.text;
      s.title = item.tooltip;
      box.append(s);
    }
  }
}

// ── Panels (sanitized HTML; buttons send actions) ──────────────────

function showPanel(rt, { title, html }) {
  closePanel(rt.id);
  const panel = document.createElement('aside');
  panel.className = 'plugin-panel';
  panel.dataset.plugin = rt.id;
  panel.setAttribute('aria-label', `${rt.manifest.name} panel`);
  const head = document.createElement('div');
  head.className = 'plugin-panel__head';
  const t = document.createElement('span');
  t.className = 'plugin-panel__title';
  t.textContent = title ? `${rt.manifest.name} · ${String(title).slice(0, 80)}` : rt.manifest.name;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'plugin-panel__close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => panel.remove());
  head.append(t, close);
  const body = document.createElement('div');
  body.className = 'plugin-panel__body nb-md';
  body.innerHTML = sanitizeHTML(String(html).slice(0, 300_000), document, { actions: true });
  body.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-action]');
    if (b) rt.emit('panel.action', { action: b.dataset.action });
  });
  panel.append(head, body);
  document.body.append(panel);
}

function closePanel(id) {
  document.querySelector(`.plugin-panel[data-plugin="${id}"]`)?.remove();
}

// ── Managing ───────────────────────────────────────────────────────

const changeListeners = new Set();
function changed() { changeListeners.forEach((fn) => { try { fn(); } catch (_) { /* ui */ } }); }
export function onPluginsChanged(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }

export const getRuntime = (id) => runtimes.get(id) || null;

export async function startPlugin(id) {
  stopPlugin(id);
  const { manifest, code, granted } = await api().pluginsCode(id);
  const rt = new Runtime({ manifest, code, granted });
  runtimes.set(id, rt);
  changed();
  return rt;
}

export function stopPlugin(id) {
  const rt = runtimes.get(id);
  if (!rt) return;
  rt.dispose();
  runtimes.delete(id);
  changed();
}

/** The Plugins menu: every plugin command, then "Manage Plugins…". */
export function pluginMenuItems() {
  const items = [];
  for (const rt of runtimes.values()) {
    for (const { short, title } of rt.commands.values()) {
      items.push({ label: `${rt.manifest.name}: ${title}`, run: () => rt.worker?.postMessage({ t: 'command', id: short }) });
    }
  }
  return items;
}

/** Start every plugin that is on, and send them events. */
export async function initPlugins() {
  if (!api()?.pluginsList) return;
  let timer = null;
  onContentChange((_u, { programmatic }) => {
    if (programmatic) return;
    clearTimeout(timer);
    timer = setTimeout(() => runtimes.forEach((rt) => rt.emit('editor.change', { fileName: getActiveFileName() })), 400);
  });
  onFileSaved((p) => {
    const root = getWorkspaceRoot();
    const rel = root && p?.toLowerCase().startsWith(root.toLowerCase()) ? p.slice(root.length + 1).replace(/\\/g, '/') : String(p || '').split(/[\\/]/).pop();
    runtimes.forEach((rt) => rt.emit('file.save', { path: rel }));
  });
  onRunFinish((run) => {
    const data = {
      ok: run.ok, fileName: run.fileName, durationMs: Math.round(run.durationMs || 0),
      stdout: String(run.stdout || '').slice(-20_000),
      error: run.error ? { type: run.error.type, message: run.error.message, line: run.error.line } : null,
    };
    runtimes.forEach((rt) => rt.emit('run.finish', data));
  });
  const list = await api().pluginsList();
  for (const p of list) {
    if (!p.enabled) continue;
    try { await startPlugin(p.id); } catch (err) { console.error('[plugin]', p.id, err); }
  }
}

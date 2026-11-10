/**
 * The sandbox a plugin runs in: a worker with no page, no Node and no app
 * internals. Before the plugin's code runs, the ways out are removed
 * (network, loading more code, browser storage, more workers); the only
 * door left is the `theta` API, which asks the app for everything and the
 * app checks each request against the permissions you allowed.
 */

const BLOCKED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts',
  'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'Request', 'Response', 'navigator',
];
for (const name of BLOCKED) {
  try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch (_) {
    try { self[name] = undefined; } catch (_e) { /* not removable */ }
  }
}

const post = self.postMessage.bind(self);
let seq = 0;
const waiting = new Map();
const listeners = new Map(); // event name -> Set(fn)
const handlers = new Map();  // command id -> fn

function call(method, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    post({ t: 'call', id, method, args });
  });
}

function on(event, fn) {
  if (typeof fn !== 'function') throw new TypeError('A function is needed.');
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
    call('events.subscribe', event).catch((err) => report(err));
  }
  set.add(fn);
  return { dispose: () => set.delete(fn) };
}

function report(err) {
  post({ t: 'error', message: String(err?.stack || err?.message || err).slice(0, 4000) });
}

function makeApi(info) {
  return Object.freeze({
    version: 1,
    plugin: Object.freeze({ id: info.id, name: info.name, version: info.version }),
    permissions: Object.freeze([...info.granted]),
    commands: Object.freeze({
      /** Add a command to the command palette and the Plugins menu. */
      register(id, title, handler) {
        if (typeof handler !== 'function') throw new TypeError('commands.register(id, title, handler) needs a handler.');
        handlers.set(String(id), handler);
        return call('commands.register', String(id), String(title));
      },
    }),
    window: Object.freeze({
      showMessage: (text, kind = 'info') => call('window.showMessage', String(text), String(kind)),
      showInput: (opts = {}) => call('window.showInput', { title: String(opts.title || 'Input'), value: String(opts.value || '') }),
      showQuickPick: (items, opts = {}) => call('window.showQuickPick', (items || []).map((i) => (typeof i === 'string' ? { label: i } : { label: String(i.label), description: i.description ? String(i.description) : '' })), { title: String(opts.title || 'Choose') }),
    }),
    statusBar: Object.freeze({
      set: (id, text, tooltip = '') => call('statusBar.set', String(id), String(text), String(tooltip)),
      remove: (id) => call('statusBar.remove', String(id)),
    }),
    log: (...parts) => call('log', parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')),
    editor: Object.freeze({
      getText: () => call('editor.getText'),
      getSelection: () => call('editor.getSelection'),
      getFileName: () => call('editor.getFileName'),
      getCursor: () => call('editor.getCursor'),
      insertText: (text) => call('editor.insertText', String(text)),
      replaceSelection: (text) => call('editor.replaceSelection', String(text)),
      setText: (text) => call('editor.setText', String(text)),
      onChange: (fn) => on('editor.change', fn),
      onSave: (fn) => on('file.save', fn),
    }),
    runs: Object.freeze({ onFinish: (fn) => on('run.finish', fn) }),
    workspace: Object.freeze({
      root: () => call('workspace.root'),
      readFile: (rel) => call('workspace.readFile', String(rel)),
      listFiles: (rel = '') => call('workspace.listFiles', String(rel)),
      writeFile: (rel, text) => call('workspace.writeFile', String(rel), String(text)),
      openFile: (rel, line) => call('workspace.openFile', String(rel), Number(line) || undefined),
    }),
    storage: Object.freeze({
      get: (key) => call('storage.get', String(key)),
      set: (key, value) => call('storage.set', String(key), value),
    }),
    ui: Object.freeze({
      /** A panel of (sanitized) HTML; buttons with data-action="x" send x to onAction. */
      showPanel: (opts) => call('ui.showPanel', { title: String(opts?.title || ''), html: String(opts?.html || '') }),
      closePanel: () => call('ui.closePanel'),
      onAction: (fn) => on('panel.action', fn),
    }),
  });
}

self.onmessage = async (e) => {
  const m = e.data || {};
  switch (m.t) {
    case 'init': {
      const theta = makeApi(m.info);
      try {
        // An async function, so a plugin may use await at the top level
        const AsyncFunction = (async () => {}).constructor;
        const run = new AsyncFunction('theta', `"use strict";\n${m.code}\n//# sourceURL=plugin-${m.info.id}.js`);
        await run(theta);
        post({ t: 'ready' });
      } catch (err) {
        report(err);
      }
      break;
    }
    case 'reply': {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.error) w.reject(new Error(m.error));
      else w.resolve(m.value);
      break;
    }
    case 'event':
      for (const fn of listeners.get(m.name) || []) {
        try { await fn(m.data); } catch (err) { report(err); }
      }
      break;
    case 'command': {
      const fn = handlers.get(m.id);
      try { await fn?.(); } catch (err) { report(err); }
      break;
    }
    default:
  }
};

self.addEventListener('error', (e) => report(e.error || e.message));
self.addEventListener('unhandledrejection', (e) => report(e.reason));

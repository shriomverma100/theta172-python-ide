/**
 * THETA172 — the plugin store (main process).
 *
 * Installed plugins live in <userData>/plugins/<id>/ (copied from a folder
 * you pick). "Developer" plugins are loaded straight from their folder, so
 * you can edit and reload them. Which plugins are on, and which permissions
 * you allowed, is kept in <userData>/plugins.json. The renderer asks for a
 * plugin's code and runs it in an isolated worker; nothing of a plugin runs
 * in this process.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateManifest, PERMISSIONS, API_VERSION } = require('./plugin-manifest.cjs');

const MAX_FILES = 200;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_STORAGE = 256 * 1024; // per plugin
const COPY_EXT = /\.(js|json|md|txt|css|html|svg|png)$/i;

class PluginStore {
  constructor({ userData }) {
    this.dir = path.join(userData, 'plugins');
    this.stateFile = path.join(userData, 'plugins.json');
    this.state = this._loadState(); // { plugins: { id: { enabled, granted, dev? } }, storage: { id: {...} } }
  }

  _loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return { plugins: s.plugins && typeof s.plugins === 'object' ? s.plugins : {}, storage: s.storage && typeof s.storage === 'object' ? s.storage : {} };
    } catch (_) {
      return { plugins: {}, storage: {} };
    }
  }

  _save() {
    try { fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2)); } catch (_) { /* best effort */ }
  }

  /** Read and check a plugin folder: { ok, manifest, dir } or { ok: false, errors }. */
  readFolder(dir) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, 'theta-plugin.json'), 'utf8'));
    } catch (err) {
      return { ok: false, errors: [err.code === 'ENOENT' ? 'This folder has no theta-plugin.json.' : `theta-plugin.json is not valid JSON: ${err.message}`] };
    }
    const res = validateManifest(raw);
    if (!res.ok) return res;
    const main = path.resolve(dir, res.manifest.main);
    if (path.relative(dir, main).startsWith('..') || !fs.existsSync(main)) return { ok: false, errors: [`The main file ${res.manifest.main} is missing.`] };
    return { ok: true, manifest: res.manifest, dir };
  }

  _folderOf(id) {
    const entry = this.state.plugins[id];
    return entry?.dev && typeof entry.dev === 'string' ? entry.dev : path.join(this.dir, id);
  }

  /** Every plugin we know about, with its state. */
  list() {
    const out = [];
    const ids = new Set(Object.keys(this.state.plugins));
    try { for (const d of fs.readdirSync(this.dir)) ids.add(d); } catch (_) { /* no plugins yet */ }
    for (const id of ids) {
      const entry = this.state.plugins[id] || {};
      const res = this.readFolder(this._folderOf(id));
      out.push({
        id,
        ok: res.ok,
        errors: res.ok ? [] : res.errors,
        manifest: res.ok ? res.manifest : null,
        enabled: !!entry.enabled && res.ok,
        granted: Array.isArray(entry.granted) ? entry.granted.filter((p) => PERMISSIONS[p]) : [],
        dev: !!entry.dev,
        folder: this._folderOf(id),
      });
    }
    return out.sort((a, b) => (a.manifest?.name || a.id).localeCompare(b.manifest?.name || b.id));
  }

  /** Copy a plugin folder in (replacing an older copy of the same plugin). */
  install(src) {
    const res = this.readFolder(src);
    if (!res.ok) return res;
    const files = [];
    let bytes = 0;
    const walk = (d, rel) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
        const full = path.join(d, ent.name);
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) { walk(full, r); continue; }
        if (!COPY_EXT.test(ent.name)) continue;
        bytes += fs.statSync(full).size;
        files.push([full, r]);
        if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error('A plugin can have at most 200 files and 5 MB.');
      }
    };
    try { walk(src, ''); } catch (err) { return { ok: false, errors: [err.message] }; }
    const dest = path.join(this.dir, res.manifest.id);
    fs.rmSync(dest, { recursive: true, force: true });
    for (const [full, rel] of files) {
      const to = path.join(dest, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(full, to);
    }
    const old = this.state.plugins[res.manifest.id] || {};
    this.state.plugins[res.manifest.id] = { enabled: false, granted: [], ...old, dev: undefined };
    delete this.state.plugins[res.manifest.id].dev;
    this._save();
    return { ok: true, manifest: res.manifest };
  }

  /** Use a folder in place (for writing a plugin). */
  link(src) {
    const res = this.readFolder(src);
    if (!res.ok) return res;
    const old = this.state.plugins[res.manifest.id] || {};
    this.state.plugins[res.manifest.id] = { enabled: false, granted: [], ...old, dev: path.resolve(src) };
    this._save();
    return { ok: true, manifest: res.manifest };
  }

  remove(id) {
    const entry = this.state.plugins[id];
    if (!entry?.dev) fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    delete this.state.plugins[id];
    delete this.state.storage[id];
    this._save();
  }

  /** Turn a plugin on (with the permissions you allowed) or off. */
  setEnabled(id, enabled, granted = []) {
    const res = this.readFolder(this._folderOf(id));
    if (!res.ok) throw new Error(res.errors[0]);
    const allowed = granted.filter((p) => res.manifest.permissions.includes(p));
    this.state.plugins[id] = { ...(this.state.plugins[id] || {}), enabled: !!enabled, granted: enabled ? allowed : (this.state.plugins[id]?.granted || []) };
    this._save();
  }

  /** The code of an enabled plugin and what it may do. */
  code(id) {
    const entry = this.state.plugins[id];
    if (!entry?.enabled) throw new Error('This plugin is off.');
    const res = this.readFolder(this._folderOf(id));
    if (!res.ok) throw new Error(res.errors[0]);
    const file = path.resolve(res.dir, res.manifest.main);
    const st = fs.statSync(file);
    if (st.size > 2 * 1024 * 1024) throw new Error('The plugin\'s main file is larger than 2 MB.');
    return { manifest: res.manifest, code: fs.readFileSync(file, 'utf8'), granted: (entry.granted || []).filter((p) => res.manifest.permissions.includes(p)) };
  }

  /** A plugin's own small key/value store. */
  storageGet(id) { return this.state.storage[id] || {}; }
  storageSet(id, data) {
    const json = JSON.stringify(data ?? {});
    if (json.length > MAX_STORAGE) throw new Error('Plugin storage is limited to 256 KB.');
    this.state.storage[id] = JSON.parse(json);
    this._save();
  }
}

function registerPluginIpc({ ipcMain, dialog, getWindow, userData, shell }) {
  const store = new PluginStore({ userData });
  const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,40}$/.test(id);
  const pick = async (title) => {
    const res = await dialog.showOpenDialog(getWindow(), { title, properties: ['openDirectory'] });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  };
  ipcMain.handle('plugins-info', () => ({ apiVersion: API_VERSION, permissions: PERMISSIONS }));
  ipcMain.handle('plugins-list', () => store.list());
  ipcMain.handle('plugins-install', async () => {
    const dir = await pick('Choose a plugin folder (with theta-plugin.json)');
    return dir ? store.install(dir) : null;
  });
  ipcMain.handle('plugins-link', async (_e, dir) => {
    const folder = typeof dir === 'string' && dir ? dir : await pick('Choose the folder of the plugin you are writing');
    return folder ? store.link(folder) : null;
  });
  ipcMain.handle('plugins-remove', (_e, id) => { if (validId(id)) store.remove(id); return store.list(); });
  ipcMain.handle('plugins-set-enabled', (_e, id, enabled, granted) => {
    if (!validId(id)) throw new Error('Invalid plugin.');
    store.setEnabled(id, !!enabled, Array.isArray(granted) ? granted.filter((p) => typeof p === 'string') : []);
    return store.list();
  });
  ipcMain.handle('plugins-code', (_e, id) => { if (!validId(id)) throw new Error('Invalid plugin.'); return store.code(id); });
  ipcMain.handle('plugins-storage-get', (_e, id) => (validId(id) ? store.storageGet(id) : {}));
  ipcMain.handle('plugins-storage-set', (_e, id, data) => { if (validId(id)) store.storageSet(id, data); return true; });
  ipcMain.handle('plugins-open-folder', (_e, id) => {
    if (!validId(id)) return false;
    const entry = store.list().find((p) => p.id === id);
    if (entry) shell.openPath(entry.folder);
    return !!entry;
  });
  return store;
}

module.exports = { PluginStore, registerPluginIpc };

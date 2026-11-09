/**
 * THETA172 — Workspace + system terminal IPC (main process).
 *
 * Wires the Workspace and ShellSession classes to the renderer. Every path
 * from the renderer is checked by Workspace to stay inside the folder the
 * user opened with a native dialog. The last folder and the files the user
 * opened through dialogs are remembered in userData/workspace.json, so tabs
 * can be restored after a restart without trusting paths from the renderer.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Workspace } = require('./workspace.cjs');
const { ShellSession } = require('./shell-session.cjs');

const MAX_RECENT_FILES = 40;

function registerWorkspaceIpc({ ipcMain, dialog, shell, app, execFile, getWindow, fileAccess, shellEnv = (base) => base }) {
  const workspace = new Workspace({ fs, trash: (p) => shell.trashItem(p), execFile });
  const terminal = new ShellSession();
  const stateFile = path.join(app.getPath('userData'), 'workspace.json');
  let saved = loadState(stateFile);
  // Smoke test only: start with a prepared sample project as the last folder
  if (process.env.THETA_SMOKE === '1' && process.env.THETA_SMOKE_WORKSPACE) saved.lastRoot = process.env.THETA_SMOKE_WORKSPACE;
  let watcher = null;
  let changeTimer = null;
  const pending = new Set();

  // Files picked in dialogs in earlier sessions stay allowed (restored tabs)
  for (const f of saved.recentFiles) fileAccess.allow(f);

  const persist = () => {
    try { fs.writeFileSync(stateFile, JSON.stringify(saved, null, 2)); } catch (_) { /* best effort */ }
  };

  const send = (ch, ...args) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
  };

  const stopWatching = () => {
    try { watcher?.close(); } catch (_) {}
    watcher = null;
  };

  const watch = (root) => {
    stopWatching();
    try {
      watcher = fs.watch(root, { recursive: true }, (_event, file) => {
        if (file) {
          const rel = String(file);
          if (/(^|[\\/])(\.git|node_modules|__pycache__)([\\/]|$)/.test(rel) && !rel.endsWith('HEAD')) return;
          pending.add(path.join(root, rel));
        }
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => {
          send('ws-changed', [...pending]);
          pending.clear();
        }, 250);
      });
      watcher.on('error', () => stopWatching());
    } catch (_) {
      watcher = null; // the explorer still refreshes after its own operations
    }
  };

  const open = async (dir) => {
    const info = await workspace.setRoot(dir);
    saved.lastRoot = info.root;
    persist();
    watch(info.root);
    return info;
  };

  /** Run fn and turn errors into { error } for the renderer. */
  const safe = (fn) => async (_event, ...args) => {
    try {
      const value = await fn(...args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  ipcMain.handle('ws-open-folder', safe(async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Open Folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return open(result.filePaths[0]);
  }));

  // Reopen the folder from last time (path comes from our own state file)
  ipcMain.handle('ws-reopen', safe(async () => {
    if (!saved.lastRoot) return null;
    try { return await open(saved.lastRoot); } catch (_) { saved.lastRoot = null; persist(); return null; }
  }));

  ipcMain.handle('ws-close', safe(async () => {
    workspace.close();
    stopWatching();
    saved.lastRoot = null;
    persist();
    return true;
  }));

  ipcMain.handle('ws-list', safe((dir) => workspace.list(dir)));
  ipcMain.handle('ws-read', safe((file) => workspace.read(file)));
  ipcMain.handle('ws-create', safe((parent, name, type) => workspace.create(parent, name, type)));
  ipcMain.handle('ws-rename', safe((p, name) => workspace.rename(p, name)));
  ipcMain.handle('ws-move', safe((p, dir) => workspace.move(p, dir)));
  ipcMain.handle('ws-delete', safe((p) => workspace.remove(p)));
  ipcMain.handle('ws-search', safe((q, opts) => workspace.search(q, sanitizeOpts(opts))));
  ipcMain.handle('ws-replace', safe((q, rep, opts, skip) => workspace.replaceAll(q, rep, sanitizeOpts(opts), Array.isArray(skip) ? skip : [])));
  ipcMain.handle('ws-git', safe(() => workspace.gitStatus()));
  ipcMain.handle('ws-reveal', safe(async (p) => {
    const abs = path.resolve(p);
    if (!workspace.contains(abs)) throw new Error('That path is outside the open folder.');
    shell.showItemInFolder(abs);
    return true;
  }));

  // Read a file to restore a tab: only project files or files picked in a dialog
  ipcMain.handle('file-read', safe(async (p) => {
    if (typeof p !== 'string') throw new Error('Invalid path.');
    if (workspace.contains(p)) return workspace.read(p);
    if (!fileAccess.isAllowed(p)) throw new Error('This file was not opened through a dialog.');
    const st = await fs.promises.stat(p);
    if (st.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.');
    return fs.promises.readFile(p, 'utf8');
  }));

  // ── System terminal ──
  ipcMain.handle('shell-start', (event, size = {}) => terminal.start(event.sender, { cols: size.cols, rows: size.rows, cwd: workspace.root || undefined, env: shellEnv(process.env) }));
  ipcMain.on('shell-input', (_e, data) => terminal.write(data));
  ipcMain.on('shell-resize', (_e, cols, rows) => terminal.resize(cols, rows));
  ipcMain.on('shell-kill', () => terminal.kill());

  return {
    workspace,
    /** A file chosen in an Open/Save dialog: remember it for tab restore. */
    rememberFile(filePath) {
      saved.recentFiles = [filePath, ...saved.recentFiles.filter((f) => f !== filePath)].slice(0, MAX_RECENT_FILES);
      persist();
    },
    dispose() {
      stopWatching();
      terminal.kill();
    },
  };
}

function sanitizeOpts(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  return { regex: !!o.regex, matchCase: !!o.matchCase, wholeWord: !!o.wholeWord };
}

function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      lastRoot: typeof s.lastRoot === 'string' ? s.lastRoot : null,
      recentFiles: Array.isArray(s.recentFiles) ? s.recentFiles.filter((f) => typeof f === 'string').slice(0, MAX_RECENT_FILES) : [],
    };
  } catch (_) {
    return { lastRoot: null, recentFiles: [] };
  }
}

module.exports = { registerWorkspaceIpc };

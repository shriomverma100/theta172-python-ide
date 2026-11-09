/**
 * THETA172 — Language intelligence IPC (main process).
 *
 * - lsp-start / lsp-send / lsp-message: one Python language server, relayed
 *   to the editor's LSP client. A "generation" number drops messages from a
 *   server that was replaced (e.g. after opening another folder).
 * - lsp-read-file: read-only access to library files (site-packages, stubs)
 *   but only ones the language server itself pointed at.
 * - lsp-format: Ruff formats a document from stdin.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { LanguageServer, serverScript } = require('./lsp-host.cjs');

const MAX_REMEMBERED = 1000;
const URI_IN_TEXT = /"(?:uri|targetUri)":"(file:[^"]+)"/g;

function registerLspIpc({ ipcMain, spawn, getWindow, getRoot, getPython, ruffPath, onLog }) {
  let generation = 0;
  let typeChecking = 'standard';
  const pointedAt = new Set(); // file paths the server referred to (lower-case on Windows)
  const key = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

  const send = (ch, ...args) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
  };

  const rememberUris = (text) => {
    if (!text.includes('file:')) return;
    for (const m of text.matchAll(URI_IN_TEXT)) {
      try {
        pointedAt.add(key(fileURLToPath(m[1].replace(/\\\//g, '/'))));
      } catch (_) { /* not a local file */ }
      if (pointedAt.size > MAX_REMEMBERED) pointedAt.delete(pointedAt.values().next().value);
    }
  };

  const server = new LanguageServer({
    spawn,
    command: process.execPath,
    // Electron runs the server as plain Node; a cap keeps a runaway analysis from eating memory
    args: ['--max-old-space-size=3072', serverScript(), '--stdio'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    getSettings: () => ({ pythonPath: getPython(), typeChecking }),
    onMessage: (json) => {
      rememberUris(json);
      send('lsp-message', generation, json);
    },
    onExit: (code) => send('lsp-exit', generation, code),
    onLog: (text) => onLog?.(text),
  });

  ipcMain.handle('lsp-start', () => {
    const root = getRoot();
    generation += 1;
    server.start({ cwd: root || process.cwd(), rootUri: root ? pathToFileURL(root).href : null });
    return { generation, rootUri: root ? pathToFileURL(root).href : null };
  });

  ipcMain.on('lsp-send', (_e, gen, json) => {
    if (gen === generation) server.send(json);
  });

  ipcMain.handle('lsp-stop', () => { generation += 1; server.stop(); });

  ipcMain.handle('lsp-settings', (_e, settings = {}) => {
    if (typeof settings.typeChecking === 'string') typeChecking = settings.typeChecking;
    server.configurationChanged();
    return { typeChecking };
  });

  // Read-only view of a library file the server pointed at (go to definition)
  ipcMain.handle('lsp-read-file', async (_e, uri) => {
    if (typeof uri !== 'string' || !uri.startsWith('file:')) throw new Error('Invalid file.');
    const file = fileURLToPath(uri);
    if (!pointedAt.has(key(file))) throw new Error('This file was not found by the language server.');
    if (!/\.pyi?$/i.test(file)) throw new Error('Only Python files can be shown.');
    const st = await fs.promises.stat(file);
    if (st.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.');
    return { path: file, content: await fs.promises.readFile(file, 'utf8') };
  });

  // Format with Ruff (reads pyproject.toml / ruff.toml from the project)
  ipcMain.handle('lsp-format', (_e, code, fileName) => new Promise((resolve) => {
    if (!ruffPath) return resolve({ ok: false, error: 'The formatter is not installed.' });
    if (typeof code !== 'string' || code.length > 8 * 1024 * 1024) return resolve({ ok: false, error: 'Nothing to format.' });
    const name = typeof fileName === 'string' && /^[^\\/:*?"<>|]{1,200}\.pyi?$/i.test(path.basename(fileName)) ? path.basename(fileName) : 'main.py';
    const root = getRoot();
    const stdinName = root ? path.join(root, name) : name;
    let out = '';
    let err = '';
    const proc = spawn(ruffPath, ['format', '--stdin-filename', stdinName, '-'], { cwd: root || undefined, windowsHide: true });
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) {} }, 15000);
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
    proc.on('close', (exit) => {
      clearTimeout(timer);
      if (exit === 0) resolve({ ok: true, code: out });
      else resolve({ ok: false, error: (err || 'The formatter failed.').trim().split('\n').slice(-3).join('\n') });
    });
    proc.stdin.end(code, 'utf8');
  }));

  return {
    configurationChanged: () => server.configurationChanged(),
    dispose: () => server.stop(),
  };
}

module.exports = { registerLspIpc };

/**
 * THETA172 — Debugger IPC (main process).
 *
 * debug-start   { filePath?, code, breakpoints }  → starts debugpy on a project
 *               file (in place) or, for an unsaved tab, on a temp copy
 * debug-request (command, args)  → only the commands in ALLOWED_REQUESTS
 * debug-input   (text)           → the program's input()
 * debug-stop
 * debug-read-file (path)         → read-only text of a file that appeared in a stack trace
 * Events: debug-event (event, body), debug-output (stream, text), debug-ended ({ exitCode })
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DebugSession } = require('./debug-session.cjs');

function registerDebugIpc({ ipcMain, spawn, getWindow, getWorkspace, getPython, getEnv, getAdapterPython, debugpyDir, onLog }) {
  let tempProgram = null;
  const send = (ch, ...args) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
  };
  const removeTemp = () => {
    if (tempProgram) fs.rm(tempProgram, { force: true }, () => {});
    tempProgram = null;
  };

  const session = new DebugSession({
    spawn,
    adapterPython: getAdapterPython,
    debugpyDir,
    onEvent: (event, body) => send('debug-event', event, body),
    onOutput: (stream, text) => send('debug-output', stream, text),
    onEnd: (info) => { removeTemp(); send('debug-ended', info); },
    onLog,
  });

  ipcMain.handle('debug-start', async (_e, opts = {}) => {
    const python = getPython();
    if (!python) throw new Error('No Python selected. Choose one from the status bar first.');
    if (!getAdapterPython() || !debugpyDir || !fs.existsSync(path.join(debugpyDir, 'debugpy'))) throw new Error('The debugger is not installed in this build.');
    const ws = getWorkspace();
    const root = ws?.root || null;

    let program;
    const inProject = typeof opts.filePath === 'string' && ws?.contains(opts.filePath) && /\.pyw?$/i.test(opts.filePath);
    if (inProject) {
      program = path.resolve(opts.filePath);
    } else {
      if (typeof opts.code !== 'string') throw new Error('Nothing to debug.');
      removeTemp();
      program = path.join(os.tmpdir(), `theta_debug_${crypto.randomUUID()}.py`);
      fs.writeFileSync(program, opts.code, 'utf8');
      tempProgram = program;
    }

    // Breakpoints: project files only, plus the temp copy (sent under the key "")
    const breakpoints = {};
    for (const [file, lines] of Object.entries(opts.breakpoints || {})) {
      const clean = (Array.isArray(lines) ? lines : []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
      if (!clean.length) continue;
      if (file === '') breakpoints[program] = clean;
      else if (ws?.contains(file)) breakpoints[path.resolve(file)] = clean;
    }

    const env = getEnv();
    const cwd = root || path.dirname(program);
    if (root) env.PYTHONPATH = env.PYTHONPATH ? `${root}${path.delimiter}${env.PYTHONPATH}` : root;
    try {
      await session.start({ python, program, cwd, env, breakpoints, exceptionFilters: opts.raisedExceptions ? ['raised', 'uncaught'] : ['uncaught'] });
    } catch (err) {
      await session.stop();
      removeTemp();
      throw err;
    }
    return { program, temp: !inProject };
  });

  ipcMain.handle('debug-request', (_e, command, args) => session.request(String(command), args && typeof args === 'object' ? args : {}));

  ipcMain.handle('debug-set-breakpoints', (_e, file, lines) => {
    if (!session.running) return null;
    const ws = getWorkspace();
    const target = file === '' ? tempProgram : (ws?.contains(file) ? path.resolve(file) : null);
    if (!target) return null;
    return session.setBreakpoints(target, (lines || []).filter((n) => Number.isInteger(n) && n > 0));
  });

  ipcMain.on('debug-input', (_e, text) => session.input(text));
  ipcMain.handle('debug-stop', () => session.stop());

  ipcMain.handle('debug-read-file', async (_e, file) => {
    if (typeof file !== 'string') throw new Error('Invalid file.');
    if (!session.hasSource(file)) throw new Error('This file is not part of the program being debugged.');
    const st = await fs.promises.stat(file);
    if (st.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.');
    return fs.promises.readFile(file, 'utf8');
  });

  return { dispose: () => session.stop() };
}

module.exports = { registerDebugIpc };

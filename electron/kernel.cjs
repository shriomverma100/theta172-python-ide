/**
 * THETA172 — Notebook kernels (main process).
 *
 * One kernel process per open notebook, running electron/kernel/theta_kernel.py
 * on the user's chosen Python. Messages are JSON lines marked with MARK; any
 * other line a program prints straight to the process's stdout is shown as
 * plain output.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MARK = '\x1e@theta@';
const MAX_KERNELS = 20;

/** Where the kernel script is (outside app.asar when packaged, so Python can read it). */
function kernelScript() {
  return path.join(__dirname, 'kernel', 'theta_kernel.py').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

class Kernel {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn
   * @param {(msg: object) => void} deps.onMessage
   * @param {(code: number|null) => void} [deps.onExit]
   * @param {string} [deps.script]
   */
  constructor({ spawn, onMessage, onExit, script = kernelScript() }) {
    Object.assign(this, { _spawn: spawn, onMessage, onExit, script });
    this.proc = null;
    this.busyId = null; // the execute request that is running
  }

  get running() { return !!this.proc; }

  /** Start the kernel; resolves with { python } once it is ready. */
  start({ python, cwd, env }) {
    this.stop();
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = this._spawn(python, ['-u', '-X', 'utf8', this.script], {
          cwd,
          env: { ...env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        reject(err);
        return;
      }
      this.proc = proc;
      let ready = false;
      let pending = '';
      proc.stdin.on('error', () => {}); // writes after exit
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => {
        if (this.proc !== proc) return;
        pending += chunk;
        let nl;
        while ((nl = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, nl).replace(/\r$/, '');
          pending = pending.slice(nl + 1);
          this._line(line, (msg) => {
            if (msg.type === 'ready' && !ready) { ready = true; resolve({ python: msg.python, executable: msg.executable }); }
          });
        }
      });
      proc.stderr.setEncoding('utf8');
      // The kernel sends user stderr as messages; this is Python itself failing
      proc.stderr.on('data', (text) => {
        if (this.proc === proc) this.onMessage({ type: 'stream', id: this.busyId, name: 'stderr', text });
      });
      proc.on('error', (err) => {
        if (!ready) reject(err);
      });
      proc.on('exit', (code) => {
        if (this.proc !== proc) return;
        this.proc = null;
        if (!ready) reject(new Error(`Python stopped while starting (exit code ${code}).`));
        if (this.busyId) this.onMessage({ type: 'done', id: this.busyId, status: 'error', died: true });
        this.busyId = null;
        this.onExit?.(code);
      });
    });
  }

  _line(line, onReady) {
    if (line.startsWith(MARK)) {
      let msg;
      try { msg = JSON.parse(line.slice(MARK.length)); } catch (_) { return; }
      if (msg.type === 'done' && msg.id === this.busyId) this.busyId = null;
      onReady(msg);
      this.onMessage(msg);
    } else if (line) {
      // Output that bypassed the kernel (e.g. a subprocess writing to stdout)
      this.onMessage({ type: 'stream', id: this.busyId, name: 'stdout', text: `${line}\n` });
    }
  }

  _send(msg) {
    if (!this.proc) return false;
    try { this.proc.stdin.write(`${JSON.stringify(msg)}\n`); return true; } catch (_) { return false; }
  }

  execute(id, code) {
    if (!this.proc) return false;
    this.busyId = id;
    return this._send({ type: 'execute', id, code });
  }

  /** Chain Lens: evaluate each prefix of a chain; answered by a lens-result message. */
  lens(id, parts) { return this._send({ type: 'lens', id, parts }); }

  input(value) { return this._send({ type: 'input_reply', value: String(value) }); }
  interrupt() { return this._send({ type: 'interrupt' }); }

  stop() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    this.busyId = null;
    try { proc.stdin.end(`${JSON.stringify({ type: 'shutdown' })}\n`); } catch (_) { /* gone */ }
    setTimeout(() => { try { if (proc.exitCode === null) proc.kill(); } catch (_) { /* gone */ } }, 800);
  }
}

/**
 * IPC: nb-start / nb-execute / nb-input / nb-interrupt / nb-restart / nb-shutdown,
 * events nb-message (notebookId, msg) and nb-exit (notebookId, code).
 */
function registerNotebookIpc({ ipcMain, spawn, getWindow, getPython, getEnv, getWorkspace, tmpDir }) {
  const kernels = new Map();
  const send = (ch, ...args) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
  };
  const validId = (id) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id);
  const kernelFor = (id) => {
    if (!validId(id)) throw new Error('Invalid notebook.');
    const k = kernels.get(id);
    if (!k) throw new Error('The kernel is not running.');
    return k;
  };

  /** The notebook's folder (inside the project) or the project folder. */
  const workingDir = (filePath) => {
    const ws = getWorkspace();
    if (typeof filePath === 'string' && ws?.contains(filePath)) return path.dirname(path.resolve(filePath));
    return ws?.root || tmpDir;
  };

  const start = async (id, filePath) => {
    const python = getPython();
    if (!python) throw new Error('No Python selected. Choose one from the status bar.');
    let k = kernels.get(id);
    if (!k) {
      if (kernels.size >= MAX_KERNELS) throw new Error('Too many notebooks are running. Close some first.');
      k = new Kernel({
        spawn,
        onMessage: (msg) => send('nb-message', id, msg),
        onExit: (code) => send('nb-exit', id, code),
      });
      kernels.set(id, k);
    }
    const cwd = workingDir(filePath);
    if (!fs.existsSync(cwd)) throw new Error('The notebook folder no longer exists.');
    return k.start({ python, cwd, env: getEnv() });
  };

  ipcMain.handle('nb-start', (_e, id, filePath) => {
    if (!validId(id)) throw new Error('Invalid notebook.');
    return start(id, filePath);
  });
  ipcMain.handle('nb-restart', (_e, id, filePath) => {
    if (!validId(id)) throw new Error('Invalid notebook.');
    return start(id, filePath);
  });
  ipcMain.handle('nb-execute', (_e, id, runId, code) => {
    if (typeof runId !== 'string' || runId.length > 80 || typeof code !== 'string' || code.length > 2_000_000) throw new Error('Invalid cell.');
    return kernelFor(id).execute(runId, code);
  });
  ipcMain.handle('nb-lens', (_e, id, runId, parts) => {
    if (typeof runId !== 'string' || runId.length > 80 || !Array.isArray(parts) || parts.length > 30
      || !parts.every((p) => typeof p === 'string' && p.length <= 4000)) throw new Error('Invalid chain.');
    return kernelFor(id).lens(runId, parts);
  });
  ipcMain.on('nb-input', (_e, id, value) => { if (validId(id)) kernels.get(id)?.input(String(value ?? '').slice(0, 65536)); });
  ipcMain.on('nb-interrupt', (_e, id) => { if (validId(id)) kernels.get(id)?.interrupt(); });
  ipcMain.handle('nb-shutdown', (_e, id) => {
    if (!validId(id)) return;
    kernels.get(id)?.stop();
    kernels.delete(id);
  });

  return { dispose: () => { for (const k of kernels.values()) k.stop(); kernels.clear(); } };
}

module.exports = { Kernel, registerNotebookIpc, kernelScript, MARK };

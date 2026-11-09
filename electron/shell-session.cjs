/**
 * THETA172 — System terminal (main process).
 *
 * One interactive shell (PowerShell on Windows, the user's shell elsewhere)
 * in a real pseudo-terminal via node-pty, so prompts, colours, Ctrl+C and
 * programs like pip or git behave as they do in Windows Terminal.
 * node-pty is loaded lazily; if it cannot load, the Shell tab says so and
 * the rest of the app is unaffected.
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

function defaultShell(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    // Prefer PowerShell 7 when installed, else Windows PowerShell
    const pwsh = (env.PATH || '').split(';').map((d) => path.join(d, 'pwsh.exe')).find((p) => {
      try { return fs.statSync(p).isFile(); } catch (_) { return false; }
    });
    return { file: pwsh || 'powershell.exe', args: ['-NoLogo'] };
  }
  return { file: env.SHELL || '/bin/bash', args: ['-l'] };
}

class ShellSession {
  /** @param {{ loadPty?: () => any }} [deps] */
  constructor({ loadPty = () => require('node-pty') } = {}) {
    this._loadPty = loadPty;
    this._pty = null;
    this.proc = null;
    this.sender = null;
  }

  get running() { return this.proc !== null; }

  /**
   * Start (or restart) the shell.
   * @returns {{ ok: true, shell: string } | { ok: false, error: string }}
   */
  start(sender, { cols = 80, rows = 24, cwd, env = process.env } = {}) {
    this.kill();
    let pty;
    try {
      pty = this._pty || (this._pty = this._loadPty());
    } catch (err) {
      return { ok: false, error: `The system terminal is not available: ${err.message}` };
    }
    const shell = defaultShell();
    const dir = cwd && safeDir(cwd) ? cwd : os.homedir();
    let proc;
    try {
      proc = pty.spawn(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: clamp(cols, 10, 500),
        rows: clamp(rows, 2, 200),
        cwd: dir,
        env: { ...env, PYTHONIOENCODING: 'utf-8', TERM_PROGRAM: 'theta172' },
      });
    } catch (err) {
      return { ok: false, error: `Could not start ${shell.file}: ${err.message}` };
    }
    this.proc = proc;
    this.sender = sender;
    const send = (ch, ...args) => { if (sender && !sender.isDestroyed()) sender.send(ch, ...args); };
    proc.onData((data) => { if (this.proc === proc) send('shell-data', data); });
    proc.onExit(({ exitCode }) => {
      if (this.proc !== proc) return;
      this.proc = null;
      send('shell-exit', exitCode);
    });
    return { ok: true, shell: path.basename(shell.file), cwd: dir };
  }

  write(data) {
    if (this.proc && typeof data === 'string' && data.length <= 64 * 1024) this.proc.write(data);
  }

  resize(cols, rows) {
    if (!this.proc) return;
    try { this.proc.resize(clamp(cols, 10, 500), clamp(rows, 2, 200)); } catch (_) { /* exited */ }
  }

  kill() {
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try { proc.kill(); } catch (_) { /* already gone */ }
    }
  }
}

function clamp(n, lo, hi) {
  const v = Number.isFinite(n) ? Math.round(n) : lo;
  return Math.max(lo, Math.min(hi, v));
}

function safeDir(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
}

module.exports = { ShellSession, defaultShell };

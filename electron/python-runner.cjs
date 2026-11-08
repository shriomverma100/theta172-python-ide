/**
 * THETA172 — Local Python runner (main process).
 *
 * Runs the editor's code with the system Python. Each run owns its own
 * process and temp file. Events from a run that has been replaced or
 * killed are ignored, so a late "close" from an old process can never
 * clear the new run's state or delete its script.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

class PythonRunner {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn       child_process.spawn
   * @param {object}   deps.fs          { writeFileSync, unlinkSync }
   * @param {string}   deps.tmpDir      directory for temp scripts
   * @param {object}   [deps.env]       base environment
   */
  constructor({ spawn, fs, tmpDir, env = process.env }) {
    this._spawn = spawn;
    this._fs = fs;
    this._tmpDir = tmpDir;
    this._env = env;
    this.pythonPath = null;
    /** @type {{ proc: any, file: string, sender: any } | null} */
    this.current = null;
  }

  setPython(cmd) {
    this.pythonPath = cmd;
  }

  get isRunning() {
    return this.current !== null;
  }

  /**
   * Start a run. `sender` must expose send(channel, ...args) and isDestroyed().
   */
  run(code, sender) {
    const send = (channel, ...args) => {
      if (sender && !sender.isDestroyed()) sender.send(channel, ...args);
    };

    if (typeof code !== 'string') {
      send('python-stderr', 'Invalid code payload.\n');
      send('python-done', 1);
      return;
    }
    if (!this.pythonPath) {
      send('python-stderr', 'Python not found on system.\n');
      send('python-done', 1);
      return;
    }

    // Replace any active run. Its later events are ignored below.
    this._stopCurrent();

    const file = path.join(this._tmpDir, `theta_run_${crypto.randomUUID()}.py`);
    try {
      this._fs.writeFileSync(file, code, 'utf8');
    } catch (err) {
      send('python-stderr', `Could not write temp script: ${err.message}\n`);
      send('python-done', 1);
      return;
    }

    const proc = this._spawn(this.pythonPath, ['-u', file], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...this._env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    });
    const run = { proc, file, sender };
    this.current = run;
    const isCurrent = () => this.current === run;

    proc.stdout.on('data', (data) => { if (isCurrent()) send('python-stdout', data.toString()); });
    proc.stderr.on('data', (data) => { if (isCurrent()) send('python-stderr', data.toString()); });

    let finished = false;
    const finish = (exitCode) => {
      if (finished) return;
      finished = true;
      this._removeFile(file);
      if (isCurrent()) {
        this.current = null;
        send('python-done', exitCode);
      }
    };

    proc.on('close', (exitCode) => finish(exitCode ?? 0));
    proc.on('error', (err) => {
      if (isCurrent()) send('python-stderr', `Failed to start Python: ${err.message}\n`);
      finish(1);
    });
  }

  input(text) {
    const stdin = this.current?.proc?.stdin;
    if (typeof text === 'string' && stdin?.writable) stdin.write(text + '\n');
  }

  /** Stop the active run; its 'close' still reports python-done to the renderer. */
  kill() {
    const run = this.current;
    if (!run) return;
    try { run.proc.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => {
      // Still alive after a second: force it.
      if (run.proc.exitCode === null && run.proc.signalCode === null) {
        try { run.proc.kill('SIGKILL'); } catch (_) {}
      }
    }, 1000).unref?.();
  }

  /** Kill everything (app quit). */
  dispose() {
    this._stopCurrent();
  }

  _stopCurrent() {
    const run = this.current;
    if (!run) return;
    this.current = null; // detach first: its events are now ignored
    try { run.proc.kill('SIGTERM'); } catch (_) {}
  }

  _removeFile(file) {
    try { this._fs.unlinkSync(file); } catch (_) {}
  }
}

module.exports = { PythonRunner };

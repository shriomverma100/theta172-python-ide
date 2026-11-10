/**
 * THETA172 — Test runner (pytest) in the main process.
 *
 * Runs `python -m pytest -p theta_pytest` on the chosen Python in the
 * project folder and turns the plugin's lines into events for the window:
 * item, collect-error, start, result, finished, log, exit.
 */

'use strict';

const path = require('path');

const MARK = '\x1e@theta-test@';

function pluginDir() {
  return path.join(__dirname, 'kernel').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

class TestRunner {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn
   * @param {() => string|null} deps.getPython
   * @param {(base: object) => object} deps.getEnv
   * @param {() => string|null} deps.getRoot
   * @param {(ev: object) => void} deps.onEvent
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.proc = null;
    this.runId = 0;
  }

  get running() { return !!this.proc; }

  /** { ok, version } — is pytest installed in the chosen Python? */
  check() {
    const python = this.getPython();
    if (!python) return Promise.resolve({ ok: false, reason: 'no-python' });
    return new Promise((resolve) => {
      let out = '';
      let proc;
      try {
        proc = this.spawn(python, ['-c', 'import pytest; print(pytest.__version__)'], { windowsHide: true, env: this.getEnv(process.env) });
      } catch (_) { resolve({ ok: false, reason: 'no-pytest' }); return; }
      proc.stdout?.on('data', (b) => { out += b; });
      proc.on('error', () => resolve({ ok: false, reason: 'no-pytest' }));
      proc.on('close', (code) => resolve(code === 0 ? { ok: true, version: out.trim() } : { ok: false, reason: 'no-pytest' }));
    });
  }

  /**
   * Collect (collect: true) or run tests. `ids` limits the run to node ids
   * (a file, a class or one test); none = everything.
   * @returns {number} the run's id (events carry it)
   */
  start({ collect = false, ids = [] } = {}) {
    this.stop();
    const python = this.getPython();
    const root = this.getRoot();
    if (!python) throw new Error('No Python selected.');
    if (!root) throw new Error('Open a project folder to find its tests.');
    const runId = ++this.runId;
    const args = ['-m', 'pytest', '-p', 'theta_pytest', '--color=no', '-q', '-rN'];
    if (collect) args.push('--collect-only');
    for (const id of ids) args.push(String(id));
    const env = this.getEnv(process.env);
    const sep = process.platform === 'win32' ? ';' : ':';
    const proc = this.spawn(python, args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...env,
        PYTHONPATH: [pluginDir(), env.PYTHONPATH].filter(Boolean).join(sep),
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
        PYTEST_ADDOPTS: '', // the project's own pytest.ini / pyproject settings still apply
      },
    });
    this.proc = proc;
    const emit = (ev) => this.onEvent?.({ runId, collect, ...ev });
    let pending = '';
    const onOut = (chunk) => {
      pending += chunk.toString();
      let nl;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).replace(/\r$/, '');
        pending = pending.slice(nl + 1);
        const at = line.indexOf(MARK);
        if (at >= 0) {
          if (at > 0) emit({ type: 'log', text: line.slice(0, at) });
          try { emit(JSON.parse(line.slice(at + MARK.length))); } catch (_) { /* a broken line */ }
        } else if (line) emit({ type: 'log', text: `${line}\n` });
      }
    };
    proc.stdout?.on('data', onOut);
    proc.stderr?.on('data', (b) => emit({ type: 'log', text: b.toString(), stream: 'stderr' }));
    proc.on('error', (err) => { if (this.proc === proc) this.proc = null; emit({ type: 'exit', code: 1, error: err.message }); });
    proc.on('close', (code) => {
      if (pending) onOut('\n');
      if (this.proc === proc) this.proc = null;
      emit({ type: 'exit', code });
    });
    return runId;
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    if (proc) { try { proc.kill(); } catch (_) { /* gone */ } }
  }
}

function registerTestIpc({ ipcMain, runner }) {
  const validIds = (ids) => Array.isArray(ids) && ids.length <= 500 && ids.every((i) => typeof i === 'string' && i.length < 1000 && !i.startsWith('-'));
  ipcMain.handle('test-check', () => runner.check());
  ipcMain.handle('test-discover', () => runner.start({ collect: true }));
  ipcMain.handle('test-run', (_e, ids = []) => {
    if (!validIds(ids)) throw new Error('Invalid test list.');
    return runner.start({ ids });
  });
  ipcMain.on('test-stop', () => runner.stop());
}

module.exports = { TestRunner, registerTestIpc, MARK, pluginDir };

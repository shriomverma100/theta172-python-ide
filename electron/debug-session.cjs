/**
 * THETA172 — Python debugger session (main process).
 *
 * Talks the Debug Adapter Protocol to debugpy's adapter (bundled, MIT).
 * The program itself is started by us when the adapter asks
 * ("runInTerminal"), on pipes we own: its output goes to the Output pane and
 * input() reads what the user types there, exactly like a normal Run.
 *
 * The renderer never sends raw "launch"/"attach" requests: this module builds
 * the launch from a vetted program path and the active interpreter.
 */

'use strict';

const path = require('path');
const { encodeMessage, MessageReader } = require('./lsp-host.cjs');

/** Requests the editor may send during a session (no launch/attach/runInTerminal). */
const ALLOWED_REQUESTS = new Set([
  'setBreakpoints', 'setExceptionBreakpoints', 'threads', 'stackTrace', 'scopes', 'variables', 'evaluate',
  'setVariable', 'continue', 'next', 'stepIn', 'stepOut', 'pause', 'exceptionInfo', 'source',
]);

class DebugSession {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn
   * @param {string|(() => string)} deps.adapterPython   Python that runs the adapter (the bundled one)
   * @param {string} deps.debugpyDir      folder that contains the debugpy package
   * @param {(event: string, body: object) => void} deps.onEvent
   * @param {(stream: 'stdout'|'stderr', text: string) => void} deps.onOutput
   * @param {(info: { exitCode: number|null }) => void} deps.onEnd
   * @param {(text: string) => void} [deps.onLog]
   * @param {string} [deps.platform]
   */
  constructor({ spawn, adapterPython, debugpyDir, onEvent, onOutput, onEnd, onLog, platform = process.platform }) {
    Object.assign(this, { _spawn: spawn, adapterPython, debugpyDir, onEvent, onOutput, onEnd, onLog });
    this._caseless = platform === 'win32' || platform === 'darwin';
    this._path = platform === 'win32' ? path.win32 : path.posix;
    this.adapter = null;
    this.program = null; // the debuggee process
    this.exitCode = null;
    this._seq = 0;
    this._pending = new Map();
    this._ended = true;
    this.sourcePaths = new Set(); // files that appeared in stack traces (readable by the editor)
  }

  get running() { return !this._ended; }

  _key(p) { const r = this._path.resolve(p); return this._caseless ? r.toLowerCase() : r; }

  /** Whether `file` appeared in this session's stack traces (or is the program). */
  hasSource(file) { return typeof file === 'string' && this.sourcePaths.has(this._key(file)); }

  /**
   * Start debugging.
   * @param {object} o
   * @param {string} o.python          interpreter that runs the program
   * @param {string} o.program         absolute path of the .py file
   * @param {string} o.cwd
   * @param {object} o.env             full environment for the program
   * @param {Record<string, number[]>} o.breakpoints  path -> 1-based lines
   * @param {boolean} [o.stopOnEntry]
   * @param {string[]} [o.exceptionFilters]  e.g. ['uncaught'] or ['raised', 'uncaught']
   */
  async start({ python, program, cwd, env, breakpoints = {}, stopOnEntry = false, exceptionFilters = ['uncaught'] }) {
    if (this.running) await this.stop();
    this._ended = false;
    this.exitCode = null;
    this._python = python;
    this._env = env;
    this.sourcePaths = new Set([this._key(program)]);

    const reader = new MessageReader();
    const adapterPython = typeof this.adapterPython === 'function' ? this.adapterPython() : this.adapterPython;
    const adapter = this._spawn(adapterPython, [path.join(this.debugpyDir, 'debugpy', 'adapter')], {
      env: { ...process.env, PYTHONPATH: this.debugpyDir, PYTHONIOENCODING: 'utf-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.adapter = adapter;
    adapter.stdin.on('error', () => {}); // a write after the process exited fails with EPIPE; the exit handler reports the end
    adapter.stdout.on('data', (chunk) => {
      if (this.adapter !== adapter) return;
      for (const raw of reader.push(chunk)) {
        let msg;
        try { msg = JSON.parse(raw); } catch (_) { continue; }
        this._onMessage(msg);
      }
    });
    adapter.stderr.on('data', (d) => this.onLog?.(d.toString()));
    adapter.on('error', (err) => { this.onLog?.(`debugger failed to start: ${err.message}\n`); this._end(); });
    adapter.on('exit', () => { if (this.adapter === adapter) this._end(); });

    const configured = new Promise((resolve, reject) => { this._onInitialized = { resolve, reject }; });
    configured.catch(() => {}); // awaited below; this only stops an early failure being "unhandled"
    await this.request('initialize', {
      clientID: 'theta172', clientName: 'Python by THETA172', adapterID: 'debugpy',
      linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
      supportsRunInTerminalRequest: true, supportsVariableType: true, supportsVariablePaging: true,
      supportsInvalidatedEvent: false, locale: 'en',
    }, true);

    // The launch response arrives only after configurationDone
    const launched = this.request('launch', {
      name: 'Debug', type: 'python', request: 'launch',
      program, cwd, python: [python], env: {},
      console: 'integratedTerminal', justMyCode: true, stopOnEntry, redirectOutput: false,
      showReturnValue: true, subProcess: false,
    }, true);
    launched.catch(() => {});

    await configured;
    for (const [file, lines] of Object.entries(breakpoints)) {
      if (lines.length) await this.setBreakpoints(file, lines).catch(() => {});
    }
    await this.request('setExceptionBreakpoints', { filters: exceptionFilters }, true).catch(() => {});
    await this.request('configurationDone', {}, true);
    await launched;
    return { ok: true };
  }

  setBreakpoints(file, lines) {
    return this.request('setBreakpoints', {
      source: { path: file },
      breakpoints: lines.map((line) => ({ line })),
      sourceModified: false,
    }, true);
  }

  /**
   * Send a request. `internal` requests may use any command; requests from
   * the editor must be in ALLOWED_REQUESTS.
   */
  request(command, args = {}, internal = false) {
    if (!internal && !ALLOWED_REQUESTS.has(command)) return Promise.reject(new Error(`"${command}" is not allowed.`));
    if (!this.adapter || this._ended) return Promise.reject(new Error('The debugger is not running.'));
    const seq = ++this._seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(seq);
        reject(new Error(`The debugger did not answer "${command}".`));
      }, command === 'launch' ? 60000 : 20000);
      this._pending.set(seq, { resolve, reject, timer, command });
      this._write({ seq, type: 'request', command, arguments: args });
    });
  }

  /** Text the user typed for the program's input(). */
  input(text) {
    const stdin = this.program?.stdin;
    if (stdin?.writable && typeof text === 'string' && text.length <= 64 * 1024) stdin.write(`${text}\n`);
  }

  async stop() {
    if (this._ended) return;
    try { await Promise.race([this.request('disconnect', { terminateDebuggee: true }, true), new Promise((r) => setTimeout(r, 1500))]); } catch (_) { /* gone */ }
    this._end();
  }

  _write(msg) {
    try { this.adapter.stdin.write(encodeMessage(msg)); } catch (_) { /* adapter gone */ }
  }

  _onMessage(msg) {
    if (msg.type === 'response') {
      const p = this._pending.get(msg.request_seq);
      if (!p) return;
      this._pending.delete(msg.request_seq);
      clearTimeout(p.timer);
      if (msg.success) {
        if (msg.command === 'stackTrace') {
          for (const f of msg.body?.stackFrames || []) if (f.source?.path) this.sourcePaths.add(this._key(f.source.path));
        }
        p.resolve(msg.body || {});
      } else {
        p.reject(new Error(msg.message || msg.body?.error?.format || `${msg.command} failed`));
      }
      return;
    }
    if (msg.type === 'request') return this._onReverseRequest(msg);
    if (msg.type === 'event') {
      if (msg.event === 'initialized') this._onInitialized?.resolve();
      if (msg.event === 'terminated') { this._end(); return; }
      if (msg.event === 'exited') this.exitCode = msg.body?.exitCode ?? null;
      // Noise the editor doesn't need
      if (['debugpySockets', 'module', 'loadedSource', 'process', 'debugpyWaitingForServer'].includes(msg.event)) return;
      if (msg.event === 'output' && msg.body?.category === 'telemetry') return;
      this.onEvent(msg.event, msg.body || {});
    }
  }

  /** The adapter asks us to start the program: only with the interpreter we chose. */
  _onReverseRequest(msg) {
    const reply = (success, body, message) => this._write({ seq: ++this._seq, type: 'response', request_seq: msg.seq, command: msg.command, success, body, message });
    if (msg.command !== 'runInTerminal') return reply(false, undefined, 'Not supported');
    const { args = [], cwd, env = {} } = msg.arguments || {};
    if (!args.length || this._key(args[0]) !== this._key(this._python)) return reply(false, undefined, 'Unexpected program');
    const full = { ...this._env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' };
    for (const [k, v] of Object.entries(env)) {
      if (v === null || v === undefined) delete full[k];
      else full[k] = String(v);
    }
    let proc;
    try {
      proc = this._spawn(args[0], args.slice(1), { cwd, env: full, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return reply(false, undefined, err.message);
    }
    this.program = proc;
    proc.stdin?.on('error', () => {}); // a write after the process exited fails with EPIPE; the exit handler reports the end
    proc.stdout.on('data', (d) => this.onOutput('stdout', d.toString()));
    proc.stderr.on('data', (d) => this.onOutput('stderr', d.toString()));
    proc.on('error', (err) => this.onOutput('stderr', `Could not start Python: ${err.message}\n`));
    proc.on('exit', (code) => { if (this.exitCode === null) this.exitCode = code; });
    reply(true, { processId: proc.pid });
  }

  _end() {
    if (this._ended) return;
    this._ended = true;
    this._onInitialized?.reject?.(new Error('The debugger stopped before it was ready.'));
    for (const p of this._pending.values()) { clearTimeout(p.timer); p.reject(new Error('The debugger stopped.')); }
    this._pending.clear();
    const { adapter, program } = this;
    this.adapter = null;
    this.program = null;
    for (const proc of [program, adapter]) {
      try { if (proc && proc.exitCode === null) proc.kill(); } catch (_) { /* already gone */ }
    }
    this.onEnd({ exitCode: this.exitCode });
  }
}

module.exports = { DebugSession, ALLOWED_REQUESTS };

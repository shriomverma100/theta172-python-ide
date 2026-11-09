/**
 * THETA172 — Language server host (main process).
 *
 * Runs basedpyright (a Pyright fork, MIT) with Electron's own Node runtime
 * and relays JSON-RPC between it and the editor's LSP client.
 *
 * The main process answers the server's own requests itself:
 *   workspace/configuration  → settings, including the active Python, so the
 *                              server resolves imports from the right env
 *   client/registerCapability, window/workDoneProgress/create → accepted
 * Everything else is passed through unchanged.
 */

'use strict';

const path = require('path');

const HEADER_END = Buffer.from('\r\n\r\n');

/** Frame one JSON-RPC message for stdio: Content-Length counts bytes, not characters. */
function encodeMessage(json) {
  const body = Buffer.from(typeof json === 'string' ? json : JSON.stringify(json), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** Splits a byte stream into JSON-RPC message bodies (strings). */
class MessageReader {
  constructor() { this._buf = Buffer.alloc(0); }

  /** @returns {string[]} complete messages found so far */
  push(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      const end = this._buf.indexOf(HEADER_END);
      if (end < 0) break;
      const header = this._buf.subarray(0, end).toString('ascii');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { // not a header: drop up to it and resynchronise
        this._buf = this._buf.subarray(end + HEADER_END.length);
        continue;
      }
      const len = Number(m[1]);
      const start = end + HEADER_END.length;
      if (this._buf.length < start + len) break;
      out.push(this._buf.subarray(start, start + len).toString('utf8'));
      this._buf = this._buf.subarray(start + len);
    }
    return out;
  }
}

const TYPE_CHECKING = new Set(['off', 'basic', 'standard', 'strict']);

/**
 * Settings the server asks for, by section.
 * @param {string} section  e.g. "python", "basedpyright.analysis"
 * @param {{ pythonPath: string|null, typeChecking: string }} opts
 */
function settingsFor(section, { pythonPath, typeChecking }) {
  const analysis = {
    typeCheckingMode: TYPE_CHECKING.has(typeChecking) ? typeChecking : 'standard',
    diagnosticMode: 'openFilesOnly',
    autoImportCompletions: true,
    useLibraryCodeForTypes: true,
    autoSearchPaths: true,
    // basedpyright extras that are noise for learners
    inlayHints: { variableTypes: false, callArgumentNames: false, functionReturnTypes: false, genericTypes: false },
  };
  const all = {
    python: { ...(pythonPath ? { pythonPath } : {}), analysis },
    'python.analysis': analysis,
    basedpyright: { analysis, disableOrganizeImports: false },
    'basedpyright.analysis': analysis,
  };
  if (!section) return all;
  return Object.prototype.hasOwnProperty.call(all, section) ? all[section] : null;
}

/**
 * The host answers configuration requests, so it tells the server it can:
 * without this the server never asks which Python to use.
 */
function withHostCapabilities(json) {
  let msg;
  try { msg = JSON.parse(json); } catch (_) { return json; }
  if (msg?.method !== 'initialize' || !msg.params) return json;
  const caps = msg.params.capabilities || (msg.params.capabilities = {});
  caps.workspace = { ...caps.workspace, configuration: true, didChangeConfiguration: { dynamicRegistration: false }, workspaceFolders: true };
  if (msg.params.rootUri && !msg.params.workspaceFolders) {
    msg.params.workspaceFolders = [{ uri: msg.params.rootUri, name: path.basename(decodeURIComponent(msg.params.rootUri)) }];
  }
  return JSON.stringify(msg);
}

/**
 * One language server process.
 * Messages to and from it are JSON strings without headers.
 */
class LanguageServer {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn
   * @param {string} deps.command        executable (Electron itself)
   * @param {string[]} deps.args
   * @param {object} deps.env
   * @param {() => { pythonPath: string|null, typeChecking: string }} deps.getSettings
   * @param {(json: string) => void} deps.onMessage   messages for the editor
   * @param {(code: number|null) => void} [deps.onExit]
   * @param {(text: string) => void} [deps.onLog]
   */
  constructor({ spawn, command, args, env, getSettings, onMessage, onExit, onLog }) {
    Object.assign(this, { _spawn: spawn, command, args, env, getSettings, onMessage, onExit, onLog });
    this.proc = null;
    this.rootUri = null;
  }

  get running() { return !!this.proc; }

  start({ cwd, rootUri } = {}) {
    this.stop();
    this.rootUri = rootUri || null;
    const reader = new MessageReader();
    const proc = this._spawn(this.command, this.args, { cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    proc.stdin.on('error', () => {}); // a write after the process exited fails with EPIPE; the exit handler reports the end
    proc.stdout.on('data', (chunk) => {
      if (this.proc !== proc) return;
      for (const msg of reader.push(chunk)) this._fromServer(msg);
    });
    proc.stderr.on('data', (d) => this.onLog?.(d.toString()));
    proc.on('error', (err) => this.onLog?.(`language server failed to start: ${err.message}\n`));
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.onExit?.(code);
    });
    return proc;
  }

  stop() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    try { proc.stdin.end(); } catch (_) { /* already closed */ }
    try { proc.kill(); } catch (_) { /* already gone */ }
  }

  /** A message from the editor. */
  send(json) {
    if (!this.proc || typeof json !== 'string' || json.length > 32 * 1024 * 1024) return false;
    if (json.includes('"initialize"')) json = withHostCapabilities(json);
    try {
      this.proc.stdin.write(encodeMessage(json));
      return true;
    } catch (_) {
      return false;
    }
  }

  /** Settings changed (e.g. the user picked another Python): the server asks again. */
  configurationChanged() {
    this.send(JSON.stringify({ jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: {} } }));
  }

  _reply(id, result) {
    this.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  _fromServer(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (_) { return; }
    if (msg && typeof msg.method === 'string' && 'id' in msg) {
      // A request from the server to the client
      switch (msg.method) {
        case 'workspace/configuration': {
          const settings = this.getSettings();
          return this._reply(msg.id, (msg.params?.items || []).map((item) => settingsFor(item.section, settings)));
        }
        case 'client/registerCapability':
        case 'client/unregisterCapability':
        case 'window/workDoneProgress/create':
          return this._reply(msg.id, null);
        case 'workspace/workspaceFolders':
          return this._reply(msg.id, this.rootUri ? [{ uri: this.rootUri, name: path.basename(decodeURIComponent(this.rootUri)) }] : null);
        default:
          break;
      }
    }
    this.onMessage(text);
  }
}

/** Where basedpyright's language server script is (outside app.asar when packaged). */
function serverScript() {
  const p = require.resolve('basedpyright/langserver.index.js');
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

module.exports = { encodeMessage, MessageReader, settingsFor, withHostCapabilities, LanguageServer, serverScript };

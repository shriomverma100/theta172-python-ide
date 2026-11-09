/**
 * The renderer side of a notebook kernel: start/execute/interrupt through
 * the desktop app and route its messages to the notebook that owns it.
 */

const sessions = new Map();
let wired = false;

const api = () => window.electronAPI;

export const kernelsAvailable = () => !!api()?.nbStart;

function wire() {
  if (wired) return;
  wired = true;
  api().onNbMessage((id, msg) => sessions.get(id)?.onMessage(msg));
  api().onNbExit((id, code) => sessions.get(id)?.onExit(code));
}

let counter = 0;

export class KernelSession {
  /**
   * @param {object} handlers
   * @param {(msg: object) => void} handlers.onMessage
   * @param {(code: number|null) => void} handlers.onExit
   */
  constructor({ onMessage, onExit }) {
    wire();
    const rand = Math.random().toString(36).slice(2, 8);
    this.id = `nb${++counter}-${rand}`;
    this.onMessage = onMessage;
    this.onExit = onExit;
    this.info = null; // { python, executable } once started
    sessions.set(this.id, this);
  }

  async start(filePath) {
    this.info = await api().nbStart(this.id, filePath || null);
    return this.info;
  }

  async restart(filePath) {
    this.info = await api().nbRestart(this.id, filePath || null);
    return this.info;
  }

  execute(runId, code) { return api().nbExecute(this.id, runId, code); }
  input(value) { api().nbInput(this.id, value); }
  interrupt() { api().nbInterrupt(this.id); }

  async shutdown() {
    this.info = null;
    try { await api().nbShutdown(this.id); } catch (_) { /* already gone */ }
  }

  dispose() {
    this.shutdown();
    sessions.delete(this.id);
  }
}

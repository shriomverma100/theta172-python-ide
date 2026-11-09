/**
 * Shared IDE state. Modules read and write these fields instead of
 * keeping their own copies, so there is one source of truth.
 */
export const state = {
  /** CodeMirror view wrapper returned by createEditor() */
  editor: null,
  /** TerminalManager (program output) */
  terminal: null,
  /** WorkerManager (Pyodide) — null when local Python is used */
  workerManager: null,
  /** ReplManager */
  replManager: null,
  /** PipManager */
  pipManager: null,
  /** true when the system Python runs code instead of Pyodide */
  useLocalPython: false,
  /** true while user code is executing */
  isRunning: false,
  /** 'terminal' | 'repl' */
  activePane: 'terminal',
  /** editor font size in px */
  fontSize: 15,
  lastError: null,      // exception name from the last run, e.g. 'NameError'
  lastErrorLine: null,  // its line in the user's file
};

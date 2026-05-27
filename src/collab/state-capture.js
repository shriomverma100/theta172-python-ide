/**
 * THETA172 — Collab State Capture
 * Captures the sharer's IDE state and streams it to viewers.
 *
 * Captures: code, cursor, selection, terminal output, errors,
 * tabs, run status, file name, font size, theme.
 *
 * Uses diff-based sync: only sends changes, not full snapshots.
 * Debounced to avoid flooding the WebSocket with keystrokes.
 */

import { showToast } from '../toast.js';


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Debounce for code changes (ms) */
const CODE_DEBOUNCE = 150;

/** Debounce for cursor moves (ms) */
const CURSOR_DEBOUNCE = 50;

/** Full state snapshot interval (ms) — periodic refresh for late joiners */
const FULL_STATE_INTERVAL = 10000;

/** Max terminal buffer to keep (chars) */
const MAX_TERMINAL_BUFFER = 50 * 1024;


// ══════════════════════════════════════════════════════════════════
// STATE CAPTURE CLASS
// ══════════════════════════════════════════════════════════════════

export class StateCapture {
  /**
   * @param {Object} options
   * @param {Function} options.getCode       - Returns current editor code string
   * @param {Function} options.getCursor     - Returns { line, col }
   * @param {Function} options.getSelection  - Returns selection range or null
   * @param {Function} options.getFileName   - Returns active file name
   * @param {Function} options.getTabs       - Returns array of { name, active }
   * @param {Function} options.getErrors     - Returns array of { line, message }
   * @param {Function} options.getIsRunning  - Returns boolean
   * @param {Function} options.getFontSize   - Returns number
   * @param {Function} options.getTheme      - Returns 'dark' | 'light'
   * @param {Function} options.onDelta       - Called with delta object to send
   * @param {Function} options.onFullState   - Called with full state to send
   */
  constructor(options) {
    this.getCode = options.getCode;
    this.getCursor = options.getCursor;
    this.getSelection = options.getSelection || (() => null);
    this.getFileName = options.getFileName || (() => 'main.py');
    this.getTabs = options.getTabs || (() => []);
    this.getErrors = options.getErrors || (() => []);
    this.getIsRunning = options.getIsRunning || (() => false);
    this.getFontSize = options.getFontSize || (() => 14);
    this.getTheme = options.getTheme || (() => 'dark');
    this.onDelta = options.onDelta;
    this.onFullState = options.onFullState;

    // ── Previous state (for diff comparison) ──
    this._prevCode = '';
    this._prevCursorLine = 0;
    this._prevCursorCol = 0;
    this._prevFileName = '';
    this._prevIsRunning = false;
    this._prevErrorCount = 0;
    this._prevTabCount = 0;

    // ── Terminal buffer ──
    this._terminalBuffer = '';
    this._terminalDirty = false;

    // ── Timers ──
    this._codeTimer = null;
    this._cursorTimer = null;
    this._fullStateTimer = null;

    // ── Running flag ──
    this._running = false;
  }


  // ── START / STOP ──────────────────────────────────────────────

  /**
   * Start capturing state.
   * Takes an initial snapshot and begins periodic full-state broadcasts.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // Initialize previous state
    this._prevCode = this.getCode() || '';
    const cursor = this.getCursor() || { line: 1, col: 1 };
    this._prevCursorLine = cursor.line;
    this._prevCursorCol = cursor.col;
    this._prevFileName = this.getFileName();
    this._prevIsRunning = this.getIsRunning();
    this._prevErrorCount = (this.getErrors() || []).length;
    this._prevTabCount = (this.getTabs() || []).length;
    this._terminalBuffer = '';

    // Send initial full state
    this.sendFullState();

    // Periodic full state for late joiners
    this._fullStateTimer = setInterval(() => {
      this.sendFullState();
    }, FULL_STATE_INTERVAL);

    console.log('[STATE-CAPTURE] Started');
  }

  /**
   * Stop capturing state.
   */
  stop() {
    this._running = false;

    if (this._codeTimer) {
      clearTimeout(this._codeTimer);
      this._codeTimer = null;
    }
    if (this._cursorTimer) {
      clearTimeout(this._cursorTimer);
      this._cursorTimer = null;
    }
    if (this._fullStateTimer) {
      clearInterval(this._fullStateTimer);
      this._fullStateTimer = null;
    }

    console.log('[STATE-CAPTURE] Stopped');
  }


  // ── CODE CHANGE ───────────────────────────────────────────────

  /**
   * Call this whenever the editor content changes.
   * Debounced — will batch rapid keystrokes.
   */
  onCodeChange() {
    if (!this._running) return;

    if (this._codeTimer) clearTimeout(this._codeTimer);

    this._codeTimer = setTimeout(() => {
      this._codeTimer = null;

      const code = this.getCode() || '';
      if (code === this._prevCode) return;

      this._prevCode = code;

      this._emitDelta({ code });
    }, CODE_DEBOUNCE);
  }


  // ── CURSOR MOVE ───────────────────────────────────────────────

  /**
   * Call this whenever the cursor position changes.
   * Debounced more aggressively since cursor moves are frequent.
   */
  onCursorMove() {
    if (!this._running) return;

    if (this._cursorTimer) clearTimeout(this._cursorTimer);

    this._cursorTimer = setTimeout(() => {
      this._cursorTimer = null;

      const cursor = this.getCursor() || { line: 1, col: 1 };
      if (cursor.line === this._prevCursorLine && cursor.col === this._prevCursorCol) return;

      this._prevCursorLine = cursor.line;
      this._prevCursorCol = cursor.col;

      const delta = { cursor: { line: cursor.line, col: cursor.col } };

      // Include selection if any
      const selection = this.getSelection();
      if (selection) {
        delta.selection = selection;
      }

      this._emitDelta(delta);
    }, CURSOR_DEBOUNCE);
  }


  // ── TERMINAL OUTPUT ───────────────────────────────────────────

  /**
   * Call this whenever new terminal output is produced.
   * @param {string} text - New text to append
   */
  onTerminalOutput(text) {
    if (!this._running || !text) return;

    // Append to buffer (capped)
    this._terminalBuffer += text;
    if (this._terminalBuffer.length > MAX_TERMINAL_BUFFER) {
      this._terminalBuffer = this._terminalBuffer.slice(-MAX_TERMINAL_BUFFER);
    }

    // Send immediately (terminal output is important for viewers)
    this._emitDelta({ terminalAppend: text });
  }


  // ── RUN STATUS ────────────────────────────────────────────────

  /**
   * Call this when the run state changes (started/stopped).
   * @param {boolean} isRunning
   */
  onRunStateChange(isRunning) {
    if (!this._running) return;
    if (isRunning === this._prevIsRunning) return;

    this._prevIsRunning = isRunning;
    this._emitDelta({ isRunning });
  }


  // ── ERRORS ────────────────────────────────────────────────────

  /**
   * Call this when the error list changes.
   * @param {Array<{line: number, message: string}>} errors
   */
  onErrorsChange(errors) {
    if (!this._running) return;

    const newCount = (errors || []).length;
    if (newCount === this._prevErrorCount && newCount === 0) return;

    this._prevErrorCount = newCount;
    this._emitDelta({
      errors: (errors || []).map((e) => ({
        line: e.line || e.lineNumber || 0,
        message: e.message || e.msg || '',
      })),
    });
  }


  // ── FILE / TAB CHANGES ────────────────────────────────────────

  /**
   * Call this when the active file or tabs change.
   */
  onTabChange() {
    if (!this._running) return;

    const fileName = this.getFileName();
    const tabs = this.getTabs();

    const delta = {};
    let changed = false;

    if (fileName !== this._prevFileName) {
      this._prevFileName = fileName;
      delta.fileName = fileName;
      changed = true;
    }

    if ((tabs || []).length !== this._prevTabCount) {
      this._prevTabCount = (tabs || []).length;
      delta.tabs = tabs;
      changed = true;
    }

    if (changed) {
      this._emitDelta(delta);
    }
  }


  // ── TERMINAL CLEAR ────────────────────────────────────────────

  /**
   * Call this when the terminal is cleared.
   */
  onTerminalClear() {
    if (!this._running) return;
    this._terminalBuffer = '';
    this._emitDelta({ terminalClear: true });
  }


  // ── FULL STATE SNAPSHOT ───────────────────────────────────────

  /**
   * Build and send a complete IDE state snapshot.
   * Used for initial sync and periodic refresh.
   */
  sendFullState() {
    if (!this._running) return;

    try {
      const cursor = this.getCursor() || { line: 1, col: 1 };
      const state = {
        code: this.getCode() || '',
        cursor: { line: cursor.line, col: cursor.col },
        selection: this.getSelection(),
        terminal: this._terminalBuffer,
        fileName: this.getFileName(),
        tabs: this.getTabs(),
        errors: (this.getErrors() || []).map((e) => ({
          line: e.line || e.lineNumber || 0,
          message: e.message || e.msg || '',
        })),
        isRunning: this.getIsRunning(),
        fontSize: this.getFontSize(),
        theme: this.getTheme(),
      };

      if (this.onFullState) {
        this.onFullState(state);
      }
    } catch (err) {
      console.warn(`[STATE-CAPTURE] Error building full state: ${err.message}`);
    }
  }


  // ── INTERNAL ──────────────────────────────────────────────────

  /**
   * Emit a state delta to the networking layer.
   * @param {Object} delta - Only the changed fields
   */
  _emitDelta(delta) {
    if (!this._running) return;
    if (this.onDelta) {
      this.onDelta(delta);
    }
  }
}

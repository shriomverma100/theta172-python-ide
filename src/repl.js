/**
 * THETA172 — Interactive Python REPL
 * A fully functional REPL (like Python IDLE) running in xterm.js.
 *
 * Two modes:
 *  1. LOCAL: pipes to a persistent `python -i -u` process via Electron IPC.
 *  2. PYODIDE: uses the Pyodide Web Worker with codeop-based completeness checks.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

// ── Theme (matches the main terminal) ───────────────────────────
const REPL_THEME = {
  background:  '#111111',
  foreground:  '#EAEAE8',
  cursor:      '#FF2D00',
  cursorAccent:'#111111',
  selectionBackground: 'rgba(255, 45, 0, 0.3)',
  black:   '#111111', red:     '#FF5A3C', green:   '#A8E6A3',
  yellow:  '#FFD580', blue:    '#82AAFF', magenta: '#C792EA',
  cyan:    '#89DDFF', white:   '#EAEAE8',
  brightBlack:  '#555555', brightRed:    '#FF8A70',
  brightGreen:  '#C3E88D', brightYellow: '#FFE0B2',
  brightBlue:   '#B0C4FF', brightMagenta:'#D6ACFF',
  brightCyan:   '#B2EBF2', brightWhite:  '#FFFFFF',
};

export class ReplManager {
  constructor() {
    this.term = null;
    this.fitAddon = null;
    this.webglAddon = null;
    this.mode = null;        // 'local' | 'pyodide'
    this.worker = null;      // Pyodide worker reference
    this.started = false;
    this.destroyed = false;

    // ── Input state ──
    this.currentLine = '';
    this.cursorPos = 0;      // cursor position within currentLine
    this.codeBuffer = '';    // accumulated multi-line code
    this.inBlock = false;    // are we inside a multi-line block?
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 100;
    this.processing = false; // waiting for worker eval
    this.promptReady = false;

    // Resize observer
    this._resizeObserver = null;
    // Disposables (onData listeners) for cleanup
    this._disposables = [];
  }

  /** Initialize the REPL xterm and attach to the given container */
  init(container) {
    if (this.term) return;

    this.term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 14,
      lineHeight: 1.4,
      theme: REPL_THEME,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
      convertEol: true,
      smoothScrollDuration: 150,
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);

    // GPU-accelerated WebGL rendering
    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
      this.term.loadAddon(this.webglAddon);
    } catch (_) {}

    // Fit to container
    requestAnimationFrame(() => {
      try { this.fitAddon.fit(); } catch (_) {}
    });

    // Auto-resize
    this._resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { this.fitAddon.fit(); } catch (_) {}
      });
    });
    this._resizeObserver.observe(container);
  }

  /** Start the REPL in 'local' or 'pyodide' mode */
  start(mode, worker) {
    this.mode = mode;
    this.worker = worker;
    this.started = true;
    this.destroyed = false;

    // Clean up old disposables before re-attaching
    this._disposeListeners();

    if (mode === 'local') {
      this._startLocal();
    } else {
      this._startPyodide();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  LOCAL MODE: pipe to python -i -u via Electron IPC
  // ═══════════════════════════════════════════════════════════════
  _startLocal() {
    const api = window.electronAPI;
    if (!api) return;

    this.term.reset();
    this.term.writeln('\x1b[38;2;102;102;100m╭─ THETA172 Python REPL ─────────────────────╮\x1b[0m');
    this.term.writeln('\x1b[38;2;102;102;100m│  Interactive Python — type and press Enter  │\x1b[0m');
    this.term.writeln('\x1b[38;2;102;102;100m╰────────────────────────────────────────────╯\x1b[0m');
    this.term.writeln('');

    // Local input buffer (python -i with pipes doesn't echo)
    this.currentLine = '';
    this.historyIndex = this.history.length;

    // Start the python -i process
    api.startRepl();

    // Receive stdout from the REPL process
    api.onReplStdout((data) => {
      if (!this.destroyed) this.term.write(data);
    });

    // Receive stderr (prompts + errors) from the REPL process
    api.onReplStderr((data) => {
      if (!this.destroyed) this.term.write(data);
    });

    // Process exited
    api.onReplExit((code) => {
      if (!this.destroyed) {
        this.term.writeln(`\r\n\x1b[38;2;102;102;100m[REPL exited with code ${code}]\x1b[0m`);
        setTimeout(() => {
          if (!this.destroyed) {
            this.currentLine = '';
            api.startRepl();
          }
        }, 500);
      }
    });

    // Handle keyboard input with manual echo
    const onDataDisposable = this.term.onData((data) => {
      if (this.destroyed) return;

      for (let i = 0; i < data.length; i++) {
        const ch = data[i];

        if (ch === '\r' || ch === '\n') {
          // Enter — send line to python stdin
          this.term.write('\r\n');
          this._softClear();
          if (this.currentLine.trim()) {
            this.history.push(this.currentLine);
            if (this.history.length > this.maxHistory) this.history.shift();
          }
          api.sendReplInput(this.currentLine);
          this.currentLine = '';
          this.cursorPos = 0;
          this.historyIndex = this.history.length;

        } else if (ch === '\x7F' || ch === '\b') {
          // Backspace at cursor position
          if (this.cursorPos > 0) {
            const atEnd = this.cursorPos === this.currentLine.length;
            this.currentLine = this.currentLine.slice(0, this.cursorPos - 1) + this.currentLine.slice(this.cursorPos);
            this.cursorPos--;
            if (atEnd) {
              this.term.write('\b \b');
            } else {
              this._redrawFromCursor();
            }
          }

        } else if (ch === '\x03') {
          // Ctrl+C — interrupt
          this.term.write('^C\r\n');
          this.currentLine = '';
          this.cursorPos = 0;
          api.killRepl();
          setTimeout(() => {
            if (!this.destroyed) api.startRepl();
          }, 200);

        } else if (ch === '\x1b' && data[i + 1] === '[') {
          const arrow = data[i + 2];
          i += 2;

          if (arrow === 'A') {
            // Up arrow — history
            if (this.history.length > 0 && this.historyIndex > 0) {
              this.historyIndex--;
              this._replaceCurrentLine(this.history[this.historyIndex] || '');
            }
          } else if (arrow === 'B') {
            // Down arrow — history
            if (this.historyIndex < this.history.length - 1) {
              this.historyIndex++;
              this._replaceCurrentLine(this.history[this.historyIndex] || '');
            } else {
              this.historyIndex = this.history.length;
              this._replaceCurrentLine('');
            }
          } else if (arrow === 'C') {
            // Right arrow
            if (this.cursorPos < this.currentLine.length) {
              this.cursorPos++;
              this.term.write('\x1b[C');
            }
          } else if (arrow === 'D') {
            // Left arrow
            if (this.cursorPos > 0) {
              this.cursorPos--;
              this.term.write('\x1b[D');
            }
          } else if (arrow === 'H') {
            // Home
            if (this.cursorPos > 0) {
              this.term.write(`\x1b[${this.cursorPos}D`);
              this.cursorPos = 0;
            }
          } else if (arrow === 'F') {
            // End
            const move = this.currentLine.length - this.cursorPos;
            if (move > 0) {
              this.term.write(`\x1b[${move}C`);
              this.cursorPos = this.currentLine.length;
            }
          }

        } else if (ch >= ' ') {
          // Insert character at cursor position
          const atEnd = this.cursorPos === this.currentLine.length;
          this.currentLine = this.currentLine.slice(0, this.cursorPos) + ch + this.currentLine.slice(this.cursorPos);
          this.cursorPos++;
          if (atEnd) {
            this.term.write(ch);
          } else {
            this._redrawFromCursor();
          }
        }
      }
    });
    this._disposables.push(onDataDisposable);
  }

  // ═══════════════════════════════════════════════════════════════
  //  PYODIDE MODE: evaluate via worker with codeop completeness
  // ═══════════════════════════════════════════════════════════════
  _startPyodide() {
    if (!this.worker) return;

    this.term.reset();
    this.term.writeln('\x1b[38;2;102;102;100m╭─ THETA172 Python REPL (Pyodide) ───────────╮\x1b[0m');
    this.term.writeln('\x1b[38;2;102;102;100m│  Interactive Python — type and press Enter  │\x1b[0m');
    this.term.writeln('\x1b[38;2;102;102;100m╰────────────────────────────────────────────╯\x1b[0m');
    this.term.writeln('');

    // Reset state
    this.currentLine = '';
    this.codeBuffer = '';
    this.inBlock = false;
    this.historyIndex = -1;
    this.processing = false;
    this.promptReady = true;

    // Show first prompt
    this._writePrompt();

    // Handle worker messages for REPL
    this._workerHandler = (e) => {
      const { type, result, text, message } = e.data;

      if (type === 'repl-check-result') {
        this._handleCheckResult(result);
      } else if (type === 'repl-done') {
        this.processing = false;
        this._writePrompt();
      } else if (type === 'repl-error') {
        this.term.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
        this.processing = false;
        this.codeBuffer = '';
        this.inBlock = false;
        this._writePrompt();
      } else if (type === 'stdout') {
        this.term.write(text.replace(/\n/g, '\r\n'));
      } else if (type === 'stderr') {
        this.term.write(`\x1b[31m${text.replace(/\n/g, '\r\n')}\x1b[0m`);
      }
    };
    this.worker.addEventListener('message', this._workerHandler);

    // Handle keyboard input
    const onDataDisposable = this.term.onData((data) => {
      if (this.destroyed || this.processing || !this.promptReady) return;

      let i = 0;
      while (i < data.length) {
        const ch = data[i];

        if (ch === '\r' || ch === '\n') {
          this._handleEnter();
          i++;
        } else if (ch === '\x7F' || ch === '\b') {
          // Backspace at cursor position
          if (this.cursorPos > 0) {
            const atEnd = this.cursorPos === this.currentLine.length;
            this.currentLine = this.currentLine.slice(0, this.cursorPos - 1) + this.currentLine.slice(this.cursorPos);
            this.cursorPos--;
            if (atEnd) {
              this.term.write('\b \b');
            } else {
              this._redrawFromCursor();
            }
          }
          i++;
        } else if (ch === '\x03') {
          // Ctrl+C
          this.term.write('^C');
          this.currentLine = '';
          this.cursorPos = 0;
          this.codeBuffer = '';
          this.inBlock = false;
          this._writePrompt();
          i++;
        } else if (ch === '\x04') {
          // Ctrl+D
          if (this.currentLine.length === 0 && this.inBlock) {
            this._handleEnter();
          }
          i++;
        } else if (ch === '\x1b' && data[i + 1] === '[') {
          const arrow = data[i + 2];
          if (arrow === 'A') this._historyUp();
          else if (arrow === 'B') this._historyDown();
          else if (arrow === 'C') {
            // Right arrow
            if (this.cursorPos < this.currentLine.length) {
              this.cursorPos++;
              this.term.write('\x1b[C');
            }
          } else if (arrow === 'D') {
            // Left arrow
            if (this.cursorPos > 0) {
              this.cursorPos--;
              this.term.write('\x1b[D');
            }
          } else if (arrow === 'H') {
            // Home
            if (this.cursorPos > 0) {
              this.term.write(`\x1b[${this.cursorPos}D`);
              this.cursorPos = 0;
            }
          } else if (arrow === 'F') {
            // End
            const move = this.currentLine.length - this.cursorPos;
            if (move > 0) {
              this.term.write(`\x1b[${move}C`);
              this.cursorPos = this.currentLine.length;
            }
          }
          i += 3;
        } else if (ch >= ' ') {
          // Insert character at cursor position
          const atEnd = this.cursorPos === this.currentLine.length;
          this.currentLine = this.currentLine.slice(0, this.cursorPos) + ch + this.currentLine.slice(this.cursorPos);
          this.cursorPos++;
          if (atEnd) {
            this.term.write(ch);
          } else {
            this._redrawFromCursor();
          }
          i++;
        } else {
          i++;
        }
      }
    });
    this._disposables.push(onDataDisposable);
  }

  _writePrompt() {
    const prompt = this.inBlock ? '... ' : '>>> ';
    this.term.write(`\r\n\x1b[32m${prompt}\x1b[0m`);
    this.currentLine = '';
    this.cursorPos = 0;
    this.promptReady = true;
  }

  _handleEnter() {
    this.promptReady = false;
    const line = this.currentLine;

    // Add to history (non-empty lines)
    if (line.trim()) {
      this.history.push(line);
      if (this.history.length > this.maxHistory) this.history.shift();
    }
    this.historyIndex = this.history.length;

    if (this.inBlock) {
      this.codeBuffer += '\n' + line;

      if (line.trim() === '') {
        // Empty line ends block → execute
        this._executeCode(this.codeBuffer);
        this.codeBuffer = '';
        this.inBlock = false;
        return;
      }

      // Continue collecting block lines
      this._writePrompt();
      return;
    }

    // Single line — check if it starts a block or is complete
    if (this.codeBuffer === '') {
      this.codeBuffer = line;
    } else {
      this.codeBuffer += '\n' + line;
    }

    // Ask the worker to check completeness
    this.worker.postMessage({
      type: 'repl-check',
      data: null,
      code: this.codeBuffer,
    });
  }

  _handleCheckResult(result) {
    if (result === 'incomplete') {
      // Need more input
      this.inBlock = true;
      this._writePrompt();
    } else if (result === 'complete') {
      // Execute the code
      this._executeCode(this.codeBuffer);
      this.codeBuffer = '';
      this.inBlock = false;
    } else if (result.startsWith('error:')) {
      // Syntax error
      const parts = result.split(':');
      const msg = parts[1] || 'invalid syntax';
      this.term.writeln('');
      this.term.writeln(`\x1b[31m  File "<stdin>"\x1b[0m`);
      this.term.writeln(`\x1b[31mSyntaxError: ${msg}\x1b[0m`);
      this.codeBuffer = '';
      this.inBlock = false;
      this._writePrompt();
    }
  }

  _executeCode(code) {
    if (!code.trim()) {
      this._writePrompt();
      return;
    }

    // Soft clear — push old content into scrollback, start fresh
    this._softClear();
    // Show the code being executed
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      const prompt = i === 0 ? '>>> ' : '... ';
      this.term.writeln(`\x1b[38;2;80;80;78m${prompt}${line}\x1b[0m`);
    });
    this.term.writeln('');

    this.processing = true;
    this.worker.postMessage({ type: 'repl-eval', data: null, code });
  }

  _historyUp() {
    if (this.history.length === 0) return;
    if (this.historyIndex > 0) {
      this.historyIndex--;
    }
    this._replaceCurrentLine(this.history[this.historyIndex] || '');
  }

  _historyDown() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this._replaceCurrentLine(this.history[this.historyIndex] || '');
    } else {
      this.historyIndex = this.history.length;
      this._replaceCurrentLine('');
    }
  }

  _replaceCurrentLine(newLine) {
    // Move cursor to start of the typed text
    if (this.cursorPos > 0) {
      this.term.write(`\x1b[${this.cursorPos}D`);
    }
    // Clear from cursor to end of line
    this.term.write('\x1b[K');
    // Write new content
    this.currentLine = newLine;
    this.cursorPos = newLine.length;
    this.term.write(newLine);
  }

  /**
   * Redraw from cursor position to end of line.
   * Never touches the prompt — only redraws user text from cursorPos onward.
   */
  _redrawFromCursor() {
    // Write everything from cursorPos to end of line
    const tail = this.currentLine.slice(this.cursorPos);
    // Save cursor, write tail, erase leftover, restore cursor
    this.term.write('\x1b[s');         // save cursor position
    this.term.write(tail + '\x1b[K'); // write remaining text + clear to end
    this.term.write('\x1b[u');         // restore cursor position
  }

  /** Soft clear — push visible content into scrollback so new output starts at top */
  _softClear() {
    const rows = this.term.rows || 24;
    for (let i = 0; i < rows; i++) {
      this.term.writeln('');
    }
    this.term.write(`\x1b[${rows}A\x1b[J`);
  }

  /** Fit the terminal to its container */
  fit() {
    try { this.fitAddon?.fit(); } catch (_) {}
  }

  /** Stop and clean up */
  destroy() {
    this.destroyed = true;
    this.started = false;

    if (this.mode === 'local' && window.electronAPI) {
      window.electronAPI.killRepl();
    }

    if (this._workerHandler && this.worker) {
      this.worker.removeEventListener('message', this._workerHandler);
      this._workerHandler = null;
    }

    this._disposeListeners();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  /** Dispose all terminal event listeners */
  _disposeListeners() {
    for (const d of this._disposables) {
      try { d.dispose(); } catch (_) {}
    }
    this._disposables = [];
  }

  /** Restart the REPL */
  restart() {
    this.destroy();
    this.destroyed = false;
    this.start(this.mode, this.worker);
  }
}

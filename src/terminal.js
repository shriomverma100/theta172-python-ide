/**
 * THETA172 — Terminal Module (Smooth Edition)
 * xterm.js with typewriter welcome, smooth inline input.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { xtermTheme, XTERM_FONT } from './core/terminal-theme.js';

export class TerminalManager {
  constructor(container) {
    this.container = container;
    this.term = null;
    this.fitAddon = null;
    this.webglAddon = null;
    this.isInputMode = false;
    this.inputBuffer = '';
    this.onInputSubmit = null;
    this._resizeObserver = null;
    this._inputHistory = [];
    this._historyIndex = -1;
  }

  init() {
    this.term = new Terminal({
      fontFamily: XTERM_FONT,
      fontSize: 14,
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.5,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowTransparency: false,
      scrollback: 10000,
      convertEol: true,
      smoothScrollDuration: 150,   // silky smooth scroll
      theme: xtermTheme(),
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.container);

    // GPU-accelerated WebGL rendering (900% faster)
    try {
      this.webglAddon = new WebglAddon();
      this.webglAddon.onContextLoss(() => {
        console.warn('[THETA] WebGL context lost — falling back to canvas');
        this.webglAddon?.dispose();
        this.webglAddon = null;
      });
      this.term.loadAddon(this.webglAddon);
      console.log('[THETA] ✦ WebGL terminal renderer active');
    } catch (e) {
      console.warn('[THETA] WebGL not available, using canvas renderer:', e.message);
    }

    requestAnimationFrame(() => {
      this.fitAddon.fit();
    });

    this._resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => this.fitAddon?.fit());
    });
    this._resizeObserver.observe(this.container);

    this.term.onKey(({ key, domEvent }) => {
      if (!this.isInputMode) return;
      this._handleInputKey(key, domEvent);
    });
  }

  /** Typewriter welcome animation */
  _writeWelcomeTypewriter() {
    const RED   = '\x1b[38;2;255;74;54m';
    const DIM   = '\x1b[38;2;143;143;143m';
    const BOLD  = '\x1b[1m';
    const LIGHT = '\x1b[38;2;196;196;196m';
    const RESET = '\x1b[0m';

    const lines = [
      `${RED}${'─'.repeat(52)}${RESET}`,
      ``,
      `  ${BOLD}${'\x1b[38;2;245;245;243m'}PYTHON${RESET} ${RED}by THETA172${RESET}`,
      `  ${LIGHT}Python 3.11  ·  Pyodide  ·  WebAssembly${RESET}`,
      ``,
      `  ${DIM}Ctrl+Enter${RESET}${DIM} run  ·  ${RESET}${DIM}Ctrl+T${RESET}${DIM} theme  ·  ${RESET}${DIM}Ctrl+Shift+P${RESET}${DIM} commands${RESET}`,
      ``,
      `${RED}${'─'.repeat(52)}${RESET}`,
      ``,
    ];

    let i = 0;
    const writeNext = () => {
      if (i >= lines.length) return;
      this.term.writeln(lines[i]);
      i++;
      setTimeout(writeNext, 28);
    };
    writeNext();
  }

  writeOutput(text) {
    this.term.write('\x1b[38;2;245;245;243m' + text.replace(/\n/g, '\r\n') + '\x1b[0m');
    this.term.scrollToBottom();
  }

  writeError(text) {
    this.term.write('\x1b[38;2;255;110;93m' + text.replace(/\n/g, '\r\n') + '\x1b[0m');
    this.term.scrollToBottom();
  }

  writeSystem(text) {
    this.term.write('\x1b[38;2;166;166;166m' + text.replace(/\n/g, '\r\n') + '\x1b[0m');
    this.term.scrollToBottom();
  }

  enterInputMode(prompt) {
    this.isInputMode = true;
    this.inputBuffer = '';
    this._historyIndex = -1;
    if (prompt) {
      this.term.write('\x1b[38;2;196;196;196m' + prompt + '\x1b[0m');
    }
    this.term.focus();
  }

  exitInputMode() {
    this.isInputMode = false;
    this.inputBuffer = '';
  }

  _handleInputKey(key, domEvent) {
    // Enter: submit input
    if (domEvent.key === 'Enter') {
      const value = this.inputBuffer;
      this.term.write('\r\n');
      // Add to history
      if (value.trim()) {
        this._inputHistory.push(value);
        if (this._inputHistory.length > 50) this._inputHistory.shift();
      }
      this.inputBuffer = '';
      this._historyIndex = -1;
      this.isInputMode = false;
      this.onInputSubmit?.(value);
      return;
    }

    // Backspace
    if (domEvent.key === 'Backspace') {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.term.write('\x08 \x08');
      }
      return;
    }

    // Ctrl+C: cancel
    if (domEvent.ctrlKey && domEvent.key === 'c') {
      this.term.write('^C\r\n');
      this.isInputMode = false;
      this.inputBuffer = '';
      this.onInputSubmit?.(null);
      return;
    }

    // Ctrl+V: paste from clipboard
    if (domEvent.ctrlKey && domEvent.key === 'v') {
      navigator.clipboard.readText().then(text => {
        if (!text || !this.isInputMode) return;
        // Only paste first line (no multiline input)
        const firstLine = text.split('\n')[0].replace(/\r/g, '');
        this.inputBuffer += firstLine;
        this.term.write('\x1b[38;2;245;245;243m' + firstLine + '\x1b[0m');
      }).catch(() => {});
      return;
    }

    // Up arrow: previous history
    if (domEvent.key === 'ArrowUp') {
      if (this._inputHistory.length === 0) return;
      if (this._historyIndex === -1) {
        this._historyIndex = this._inputHistory.length - 1;
      } else if (this._historyIndex > 0) {
        this._historyIndex--;
      }
      this._replaceInput(this._inputHistory[this._historyIndex]);
      return;
    }

    // Down arrow: next history
    if (domEvent.key === 'ArrowDown') {
      if (this._historyIndex === -1) return;
      if (this._historyIndex < this._inputHistory.length - 1) {
        this._historyIndex++;
        this._replaceInput(this._inputHistory[this._historyIndex]);
      } else {
        this._historyIndex = -1;
        this._replaceInput('');
      }
      return;
    }

    // Ignore other control/meta keys
    if (domEvent.ctrlKey || domEvent.altKey || domEvent.metaKey) return;
    if (domEvent.keyCode < 32 || domEvent.keyCode === 127) return;

    this.inputBuffer += key;
    this.term.write('\x1b[38;2;245;245;243m' + key + '\x1b[0m');
  }

  /** Replace current input buffer with new text (for history navigation) */
  _replaceInput(text) {
    // Erase current input
    for (let i = 0; i < this.inputBuffer.length; i++) {
      this.term.write('\x08 \x08');
    }
    this.inputBuffer = text;
    this.term.write('\x1b[38;2;245;245;243m' + text + '\x1b[0m');
  }

  writeRunSeparator() {
    // Push old output above viewport so new run starts at top
    this.softClear();
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.term.write('\x1b[38;2;255;74;54m▶\x1b[0m ');
    this.term.writeln(`\x1b[38;2;143;143;143m${time}\x1b[0m`);
    this.term.writeln('');
    this.term.scrollToBottom();
  }

  writeDoneSeparator(durationMs) {
    const secs = (durationMs / 1000).toFixed(3);
    this.term.writeln('');
    this.term.writeln(`\x1b[38;2;85;85;85m${'─'.repeat(36)}\x1b[0m`);
    this.term.writeln(`\x1b[38;2;143;143;143mDone in ${secs}s\x1b[0m`);
    this.term.writeln('');
    this.term.scrollToBottom();
  }

  writeInterrupted() {
    this.term.writeln('');
    this.term.writeln('\x1b[38;2;255;74;54m[Interrupted]\x1b[0m');
    this.term.writeln('');
    this.term.scrollToBottom();
  }

  clear() {
    this.term.clear();
  }

  /** Clear viewport, preserve scrollback — scroll up to see previous runs */
  softClear() {
    const rows = this.term.rows || 24;
    // Push visible content into scrollback by writing blank lines
    for (let i = 0; i < rows; i++) {
      this.term.writeln('');
    }
    // Move cursor to top of viewport and erase all the blank lines
    this.term.write(`\x1b[${rows}A\x1b[J`);
  }

  fit() { this.fitAddon?.fit(); }

  /** Recolour for the active app theme (Playground / Pro). */
  setTheme(theme) {
    if (this.term) this.term.options.theme = theme;
  }
  focus() { this.term?.focus(); }

  dispose() {
    this._resizeObserver?.disconnect();
    this.term?.dispose();
  }
}

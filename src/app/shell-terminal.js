/**
 * The Shell tab: a real system terminal (PowerShell on Windows) in xterm,
 * backed by node-pty in the main process (electron/shell-session.cjs).
 * It starts the first time the tab is opened, in the project folder.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { xtermTheme, XTERM_FONT } from '../core/terminal-theme.js';

export class ShellTerminal {
  constructor(container) {
    this.container = container;
    this.term = null;
    this.fitAddon = null;
    this.alive = false;
    this.starting = false;
  }

  get started() { return this.term !== null; }

  async open() {
    const api = window.electronAPI;
    if (!this.term) {
      this.term = new Terminal({
        fontFamily: XTERM_FONT,
        fontSize: 14,
        lineHeight: 1.35,
        cursorBlink: true,
        scrollback: 5000,
        theme: xtermTheme(),
        allowProposedApi: false,
      });
      this.fitAddon = new FitAddon();
      this.term.loadAddon(this.fitAddon);
      this.term.open(this.container);
      this.term.onData((data) => {
        if (this.alive) api?.shellInput?.(data);
        else if (data === '\r') this.start(); // press Enter to restart
      });
      api?.onShellData?.((data) => this.term?.write(data));
      api?.onShellExit?.((code) => {
        this.alive = false;
        this.term?.write(`\r\n\x1b[38;2;143;143;143m[Shell exited${code ? ` with code ${code}` : ''}. Press Enter to start a new one.]\x1b[0m\r\n`);
      });
      new ResizeObserver(() => this.fit()).observe(this.container);
    }
    if (!api?.shellStart) {
      this.term.write('The system terminal is available in the desktop app.\r\n');
      return;
    }
    if (!this.alive) await this.start();
    this.fit();
    this.term.focus();
  }

  /** Type a command into the shell and press Enter (tasks). Starts the shell first if needed. */
  async run(command) {
    await this.open();
    for (let i = 0; i < 50 && !this.alive; i++) await new Promise((r) => setTimeout(r, 100));
    if (!this.alive) return false;
    window.electronAPI?.shellInput?.(`${command}\r`);
    return true;
  }

  async start() {
    if (this.starting) return;
    this.starting = true;
    this.fit();
    const res = await window.electronAPI.shellStart({ cols: this.term.cols, rows: this.term.rows });
    this.starting = false;
    if (!res?.ok) {
      this.term.write(`\x1b[38;2;255;110;93m${res?.error || 'Could not start the terminal.'}\x1b[0m\r\n`);
      return;
    }
    this.alive = true;
  }

  fit() {
    if (!this.term || !this.container.offsetParent) return;
    try {
      this.fitAddon.fit();
      if (this.alive) window.electronAPI?.shellResize?.(this.term.cols, this.term.rows);
    } catch (_) { /* hidden */ }
  }

  setTheme(theme) {
    if (this.term) this.term.options.theme = theme;
  }

  focus() { this.term?.focus(); }
  clear() { this.term?.clear(); }
}

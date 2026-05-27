/**
 * THETA172 — Collab State Renderer
 * Renders the received IDE state on the viewer's screen.
 *
 * Creates a read-only overlay that mirrors the sharer's IDE:
 *   - Code (syntax-highlighted, read-only)
 *   - Cursor position (animated remote cursor)
 *   - Terminal output
 *   - File name / tabs
 *   - Run status indicator
 *   - Error markers
 *
 * The overlay sits on top of the viewer's own editor.
 * Pressing Escape or clicking "Disconnect" removes it.
 */


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Terminal scroll-to-bottom debounce (ms) */
const TERMINAL_SCROLL_DEBOUNCE = 50;

/** Max terminal lines to keep rendered */
const MAX_TERMINAL_LINES = 500;

/** Cursor animation duration (ms) */
const CURSOR_ANIM_DURATION = 120;


// ══════════════════════════════════════════════════════════════════
// STATE RENDERER CLASS
// ══════════════════════════════════════════════════════════════════

export class StateRenderer {
  constructor() {
    /** @type {HTMLElement | null} */
    this.$overlay = null;

    /** @type {HTMLElement | null} */
    this.$codeArea = null;

    /** @type {HTMLElement | null} */
    this.$terminalArea = null;

    /** @type {HTMLElement | null} */
    this.$statusBar = null;

    /** @type {HTMLElement | null} */
    this.$remoteCursor = null;

    /** @type {HTMLElement | null} */
    this.$fileNameLabel = null;

    /** @type {HTMLElement | null} */
    this.$tabBar = null;

    /** @type {HTMLElement | null} */
    this.$runIndicator = null;

    /** @type {HTMLElement | null} */
    this.$errorCount = null;

    /** @type {HTMLElement | null} */
    this.$hostNameLabel = null;

    /** @type {HTMLElement | null} */
    this.$disconnectBtn = null;

    /** @type {boolean} */
    this._active = false;

    /** @type {string} */
    this._currentCode = '';

    /** @type {number} */
    this._terminalLineCount = 0;

    /** @type {NodeJS.Timer | null} */
    this._termScrollTimer = null;

    /** @type {Function | null} */
    this.onDisconnect = null;
  }


  // ── LIFECYCLE ─────────────────────────────────────────────────

  /**
   * Create and show the viewer overlay.
   * @param {Object} options
   * @param {string} options.hostName   - Name of the sharer
   * @param {string} options.roomKey    - Room key
   * @param {Function} options.onDisconnect - Called when viewer clicks disconnect
   */
  show(options) {
    if (this._active) this.hide();
    this._active = true;

    this.onDisconnect = options.onDisconnect || null;

    // Build the overlay DOM
    this._buildOverlay(options.hostName || 'Host', options.roomKey || '---');

    // Insert into DOM
    document.body.appendChild(this.$overlay);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.$overlay.classList.add('visible');
      });
    });

    console.log('[STATE-RENDERER] Overlay shown');
  }

  /**
   * Remove the viewer overlay.
   */
  hide() {
    if (!this._active) return;
    this._active = false;

    if (this.$overlay) {
      this.$overlay.classList.remove('visible');
      // Remove after transition
      setTimeout(() => {
        this.$overlay?.remove();
        this.$overlay = null;
      }, 350);
    }

    if (this._termScrollTimer) {
      clearTimeout(this._termScrollTimer);
      this._termScrollTimer = null;
    }

    this._currentCode = '';
    this._terminalLineCount = 0;

    console.log('[STATE-RENDERER] Overlay hidden');
  }


  // ── STATE APPLICATION ─────────────────────────────────────────

  /**
   * Apply a full IDE state snapshot.
   * @param {Object} state
   */
  applyFullState(state) {
    if (!this._active) return;

    if (state.code !== undefined) {
      this._setCode(state.code);
    }

    if (state.cursor) {
      this._setCursor(state.cursor.line, state.cursor.col);
    }

    if (state.terminal !== undefined) {
      this._setTerminal(state.terminal);
    }

    if (state.fileName) {
      this._setFileName(state.fileName);
    }

    if (state.tabs) {
      this._setTabs(state.tabs);
    }

    if (state.errors) {
      this._setErrors(state.errors);
    }

    if (state.isRunning !== undefined) {
      this._setRunStatus(state.isRunning);
    }

    if (state.fontSize) {
      this._setFontSize(state.fontSize);
    }
  }

  /**
   * Apply a state delta (incremental update).
   * @param {Object} delta - Only changed fields
   */
  applyDelta(delta) {
    if (!this._active) return;

    if (delta.code !== undefined) {
      this._setCode(delta.code);
    }

    if (delta.cursor) {
      this._setCursor(delta.cursor.line, delta.cursor.col);
    }

    if (delta.selection) {
      this._setSelection(delta.selection);
    }

    if (delta.terminalAppend) {
      this._appendTerminal(delta.terminalAppend);
    }

    if (delta.terminalClear) {
      this._clearTerminal();
    }

    if (delta.fileName) {
      this._setFileName(delta.fileName);
    }

    if (delta.tabs) {
      this._setTabs(delta.tabs);
    }

    if (delta.errors) {
      this._setErrors(delta.errors);
    }

    if (delta.isRunning !== undefined) {
      this._setRunStatus(delta.isRunning);
    }
  }


  // ── DOM BUILDER ───────────────────────────────────────────────

  /**
   * Build the full overlay DOM structure.
   */
  _buildOverlay(hostName, roomKey) {
    // Main overlay container
    this.$overlay = document.createElement('div');
    this.$overlay.className = 'collab-viewer-overlay';
    this.$overlay.id = 'collab-viewer-overlay';

    // ── Top status bar ──
    this.$statusBar = document.createElement('div');
    this.$statusBar.className = 'collab-viewer-overlay__status-bar';

    // Live indicator
    const liveIndicator = document.createElement('div');
    liveIndicator.className = 'collab-viewer-overlay__live-dot';

    const liveLabel = document.createElement('span');
    liveLabel.className = 'collab-viewer-overlay__live-label';
    liveLabel.textContent = 'VIEWING LIVE';

    // Host name
    this.$hostNameLabel = document.createElement('span');
    this.$hostNameLabel.className = 'collab-viewer-overlay__host-name';
    this.$hostNameLabel.textContent = `${hostName} -- ${roomKey}`;

    // Run indicator
    this.$runIndicator = document.createElement('span');
    this.$runIndicator.className = 'collab-viewer-overlay__run-indicator';
    this.$runIndicator.textContent = 'IDLE';

    // Error count
    this.$errorCount = document.createElement('span');
    this.$errorCount.className = 'collab-viewer-overlay__error-count';
    this.$errorCount.textContent = '0 errors';

    // Disconnect button
    this.$disconnectBtn = document.createElement('button');
    this.$disconnectBtn.className = 'collab-viewer-overlay__disconnect-btn';
    this.$disconnectBtn.textContent = 'Disconnect';
    this.$disconnectBtn.addEventListener('click', () => {
      if (this.onDisconnect) this.onDisconnect();
    });

    this.$statusBar.appendChild(liveIndicator);
    this.$statusBar.appendChild(liveLabel);
    this.$statusBar.appendChild(this.$hostNameLabel);
    this.$statusBar.appendChild(this.$runIndicator);
    this.$statusBar.appendChild(this.$errorCount);
    this.$statusBar.appendChild(this.$disconnectBtn);

    // ── Tab bar ──
    this.$tabBar = document.createElement('div');
    this.$tabBar.className = 'collab-viewer-overlay__tab-bar';

    this.$fileNameLabel = document.createElement('span');
    this.$fileNameLabel.className = 'collab-viewer-overlay__file-name';
    this.$fileNameLabel.textContent = 'main.py';

    this.$tabBar.appendChild(this.$fileNameLabel);

    // ── Main content area (split: code + terminal) ──
    const contentArea = document.createElement('div');
    contentArea.className = 'collab-viewer-overlay__content';

    // Code area
    const codeWrapper = document.createElement('div');
    codeWrapper.className = 'collab-viewer-overlay__code-wrapper';

    // Line numbers
    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'collab-viewer-overlay__line-numbers';
    lineNumbers.id = 'collab-viewer-line-numbers';

    // Code pre
    this.$codeArea = document.createElement('pre');
    this.$codeArea.className = 'collab-viewer-overlay__code';
    this.$codeArea.id = 'collab-viewer-code';

    // Remote cursor
    this.$remoteCursor = document.createElement('div');
    this.$remoteCursor.className = 'collab-viewer-overlay__remote-cursor';
    this.$remoteCursor.id = 'collab-viewer-cursor';

    const cursorLine = document.createElement('div');
    cursorLine.className = 'collab-viewer-overlay__cursor-line';

    const cursorLabel = document.createElement('span');
    cursorLabel.className = 'collab-viewer-overlay__cursor-label';
    cursorLabel.textContent = hostName;

    this.$remoteCursor.appendChild(cursorLine);
    this.$remoteCursor.appendChild(cursorLabel);

    codeWrapper.appendChild(lineNumbers);
    codeWrapper.appendChild(this.$codeArea);
    codeWrapper.appendChild(this.$remoteCursor);

    // Terminal area
    const terminalWrapper = document.createElement('div');
    terminalWrapper.className = 'collab-viewer-overlay__terminal-wrapper';

    const terminalLabel = document.createElement('div');
    terminalLabel.className = 'collab-viewer-overlay__terminal-label';
    terminalLabel.textContent = 'Terminal Output';

    this.$terminalArea = document.createElement('pre');
    this.$terminalArea.className = 'collab-viewer-overlay__terminal';
    this.$terminalArea.id = 'collab-viewer-terminal';

    terminalWrapper.appendChild(terminalLabel);
    terminalWrapper.appendChild(this.$terminalArea);

    contentArea.appendChild(codeWrapper);
    contentArea.appendChild(terminalWrapper);

    // ── Assemble ──
    this.$overlay.appendChild(this.$statusBar);
    this.$overlay.appendChild(this.$tabBar);
    this.$overlay.appendChild(contentArea);
  }


  // ── CODE RENDERING ────────────────────────────────────────────

  /**
   * Set the full code content.
   */
  _setCode(code) {
    if (!this.$codeArea) return;
    this._currentCode = code;

    // Escape HTML
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Apply basic Python syntax highlighting
    const highlighted = this._highlightPython(escaped);
    this.$codeArea.innerHTML = highlighted;

    // Update line numbers
    this._updateLineNumbers(code);
  }

  /**
   * Basic Python syntax highlighting.
   * Uses CSS classes for styling.
   */
  _highlightPython(code) {
    // Keywords
    code = code.replace(
      /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|raise|pass|break|continue|yield|lambda|and|or|not|in|is|True|False|None|global|nonlocal|assert|del|async|await)\b/g,
      '<span class="cvo-kw">$1</span>'
    );

    // Strings (double-quoted)
    code = code.replace(
      /(&quot;|")((?:(?!\1).)*?)\1/g,
      '<span class="cvo-str">$1$2$1</span>'
    );

    // Strings (single-quoted)
    code = code.replace(
      /('(?:[^'\\]|\\.)*?')/g,
      '<span class="cvo-str">$1</span>'
    );

    // Comments
    code = code.replace(
      /(#.*?)$/gm,
      '<span class="cvo-comment">$1</span>'
    );

    // Numbers
    code = code.replace(
      /\b(\d+\.?\d*)\b/g,
      '<span class="cvo-num">$1</span>'
    );

    // Built-in functions
    code = code.replace(
      /\b(print|len|range|int|str|float|list|dict|set|tuple|type|input|open|sorted|map|filter|zip|enumerate|super|isinstance|hasattr|getattr|setattr)\b/g,
      '<span class="cvo-builtin">$1</span>'
    );

    // Decorators
    code = code.replace(
      /(@\w+)/g,
      '<span class="cvo-decorator">$1</span>'
    );

    // Function/class names after def/class
    code = code.replace(
      /(def|class)\s+(<span[^>]*>[^<]*<\/span>\s+)?(\w+)/g,
      '$1 <span class="cvo-funcname">$3</span>'
    );

    return code;
  }

  /**
   * Update the line number gutter.
   */
  _updateLineNumbers(code) {
    const lineNumEl = document.getElementById('collab-viewer-line-numbers');
    if (!lineNumEl) return;

    const lineCount = (code.match(/\n/g) || []).length + 1;
    const numbers = [];
    for (let i = 1; i <= lineCount; i++) {
      numbers.push(`<span>${i}</span>`);
    }
    lineNumEl.innerHTML = numbers.join('\n');
  }


  // ── CURSOR ────────────────────────────────────────────────────

  /**
   * Position the remote cursor indicator.
   * @param {number} line - 1-based line number
   * @param {number} col  - 1-based column number
   */
  _setCursor(line, col) {
    if (!this.$remoteCursor || !this.$codeArea) return;

    const lineHeight = 20; // px — matches the CSS
    const charWidth = 8.4; // px — monospace char width at 14px

    const top = (line - 1) * lineHeight;
    const left = (col - 1) * charWidth;

    this.$remoteCursor.style.transform = `translate(${left}px, ${top}px)`;
    this.$remoteCursor.style.transition = `transform ${CURSOR_ANIM_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`;

    // Flash effect on cursor
    this.$remoteCursor.classList.remove('flash');
    void this.$remoteCursor.offsetHeight; // force reflow
    this.$remoteCursor.classList.add('flash');
  }


  /**
   * Set selection range (highlight).
   */
  _setSelection(selection) {
    // Selection highlighting is handled via CSS class on the code area
    // For now, we just update the cursor to the end of selection
    if (selection && selection.endLine) {
      this._setCursor(selection.endLine, selection.endCol || 1);
    }
  }


  // ── TERMINAL ──────────────────────────────────────────────────

  /**
   * Set the full terminal content.
   */
  _setTerminal(text) {
    if (!this.$terminalArea) return;

    // Escape HTML
    const escaped = (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    this.$terminalArea.innerHTML = escaped;
    this._terminalLineCount = (text || '').split('\n').length;
    this._scrollTerminalToBottom();
  }

  /**
   * Append text to terminal.
   */
  _appendTerminal(text) {
    if (!this.$terminalArea || !text) return;

    // Escape HTML
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    this.$terminalArea.innerHTML += escaped;
    this._terminalLineCount += (text.match(/\n/g) || []).length;

    // Trim if too many lines
    if (this._terminalLineCount > MAX_TERMINAL_LINES) {
      const lines = this.$terminalArea.innerHTML.split('\n');
      const trimmed = lines.slice(-MAX_TERMINAL_LINES);
      this.$terminalArea.innerHTML = trimmed.join('\n');
      this._terminalLineCount = trimmed.length;
    }

    this._scrollTerminalToBottom();
  }

  /**
   * Clear terminal.
   */
  _clearTerminal() {
    if (!this.$terminalArea) return;
    this.$terminalArea.innerHTML = '';
    this._terminalLineCount = 0;
  }

  /**
   * Scroll terminal to bottom (debounced).
   */
  _scrollTerminalToBottom() {
    if (this._termScrollTimer) clearTimeout(this._termScrollTimer);
    this._termScrollTimer = setTimeout(() => {
      if (this.$terminalArea) {
        this.$terminalArea.scrollTop = this.$terminalArea.scrollHeight;
      }
    }, TERMINAL_SCROLL_DEBOUNCE);
  }


  // ── STATUS UPDATES ────────────────────────────────────────────

  _setFileName(name) {
    if (this.$fileNameLabel) {
      this.$fileNameLabel.textContent = name || 'main.py';
    }
  }

  _setTabs(tabs) {
    if (!this.$tabBar) return;

    // Clear all tab elements except the file name label
    const existingTabs = this.$tabBar.querySelectorAll('.collab-viewer-overlay__tab');
    existingTabs.forEach((t) => t.remove());

    (tabs || []).forEach((tab) => {
      const tabEl = document.createElement('span');
      tabEl.className = 'collab-viewer-overlay__tab';
      if (tab.active) tabEl.classList.add('active');
      tabEl.textContent = tab.name || 'untitled';
      this.$tabBar.appendChild(tabEl);
    });
  }

  _setErrors(errors) {
    if (this.$errorCount) {
      const count = (errors || []).length;
      this.$errorCount.textContent = `${count} error${count !== 1 ? 's' : ''}`;
      this.$errorCount.classList.toggle('has-errors', count > 0);
    }
  }

  _setRunStatus(isRunning) {
    if (this.$runIndicator) {
      this.$runIndicator.textContent = isRunning ? 'RUNNING' : 'IDLE';
      this.$runIndicator.classList.toggle('running', isRunning);
    }
  }

  _setFontSize(size) {
    if (this.$codeArea) {
      this.$codeArea.style.fontSize = `${size}px`;
    }
  }
}

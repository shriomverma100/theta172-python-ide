/**
 * THETA172 — Teacher Dashboard
 * Grid view showing all connected students' code in real-time.
 *
 * Features:
 *   - Auto-populating grid of student tiles
 *   - Live code preview per student (mini syntax-highlighted view)
 *   - Error/run status indicators per student
 *   - Click-to-expand full student view
 *   - Responsive grid (auto-fills based on viewer count)
 *   - Smooth tile entrance/exit animations
 *   - Student search/filter
 */


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Max code preview lines per tile */
const MAX_PREVIEW_LINES = 12;

/** Code preview update debounce (ms) */
const PREVIEW_UPDATE_DEBOUNCE = 300;

/** Dashboard refresh interval (ms) */
const DASHBOARD_REFRESH = 2000;


// ══════════════════════════════════════════════════════════════════
// DASHBOARD CLASS
// ══════════════════════════════════════════════════════════════════

export class TeacherDashboard {
  constructor() {
    /** @type {HTMLElement | null} */
    this.$overlay = null;

    /** @type {HTMLElement | null} */
    this.$grid = null;

    /** @type {HTMLElement | null} */
    this.$header = null;

    /** @type {HTMLElement | null} */
    this.$searchInput = null;

    /** @type {HTMLElement | null} */
    this.$countLabel = null;

    /** @type {HTMLElement | null} */
    this.$expandedView = null;

    /** @type {Map<string, Object>} - Student state keyed by viewer ID */
    this._students = new Map();

    /** @type {Map<string, HTMLElement>} - Tile elements keyed by viewer ID */
    this._tiles = new Map();

    /** @type {string} - Current search filter */
    this._searchFilter = '';

    /** @type {string | null} - Currently expanded student ID */
    this._expandedStudentId = null;

    /** @type {boolean} */
    this._active = false;

    /** @type {NodeJS.Timer | null} */
    this._refreshTimer = null;

    /** @type {Function | null} */
    this.onClose = null;

    /** @type {Function | null} */
    this.onHighlightStudent = null;
  }


  // ── LIFECYCLE ─────────────────────────────────────────────────

  /**
   * Show the teacher dashboard overlay.
   * @param {Object} options
   * @param {string} options.roomKey  - Current room key
   * @param {Function} options.onClose - Called when dashboard is closed
   * @param {Function} options.onHighlight - Called when teacher highlights a line
   */
  show(options = {}) {
    if (this._active) this.hide();
    this._active = true;
    this.onClose = options.onClose || null;
    this.onHighlightStudent = options.onHighlight || null;

    this._buildOverlay(options.roomKey || '---');
    document.body.appendChild(this.$overlay);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.$overlay.classList.add('visible');
      });
    });

    // Start periodic refresh
    this._refreshTimer = setInterval(() => {
      this._updateAllTiles();
    }, DASHBOARD_REFRESH);

    console.log('[DASHBOARD] Shown');
  }

  /**
   * Hide the teacher dashboard.
   */
  hide() {
    if (!this._active) return;
    this._active = false;

    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }

    if (this.$overlay) {
      this.$overlay.classList.remove('visible');
      setTimeout(() => {
        this.$overlay?.remove();
        this.$overlay = null;
      }, 350);
    }

    this._students.clear();
    this._tiles.clear();
    this._expandedStudentId = null;

    console.log('[DASHBOARD] Hidden');
  }


  // ── STUDENT STATE MANAGEMENT ──────────────────────────────────

  /**
   * Add or update a student's state.
   * Called when a viewer's state is received.
   * @param {string} viewerId
   * @param {string} viewerName
   * @param {Object} state - Full or partial IDE state
   */
  updateStudentState(viewerId, viewerName, state) {
    if (!this._active) return;

    let student = this._students.get(viewerId);

    if (!student) {
      // New student
      student = {
        id: viewerId,
        name: viewerName || 'Student',
        code: '',
        cursor: { line: 1, col: 1 },
        errors: [],
        isRunning: false,
        fileName: 'main.py',
        lastUpdate: Date.now(),
      };
      this._students.set(viewerId, student);
      this._addTile(student);
    }

    // Merge state
    if (state.code !== undefined) student.code = state.code;
    if (state.cursor) student.cursor = state.cursor;
    if (state.errors) student.errors = state.errors;
    if (state.isRunning !== undefined) student.isRunning = state.isRunning;
    if (state.fileName) student.fileName = state.fileName;
    student.lastUpdate = Date.now();

    // Update tile
    this._updateTile(viewerId);

    // Update expanded view if this student is expanded
    if (this._expandedStudentId === viewerId) {
      this._updateExpandedView(student);
    }

    // Update count
    this._updateCount();
  }

  /**
   * Remove a student (viewer disconnected).
   * @param {string} viewerId
   */
  removeStudent(viewerId) {
    this._students.delete(viewerId);

    const tile = this._tiles.get(viewerId);
    if (tile) {
      tile.classList.add('removing');
      setTimeout(() => {
        tile.remove();
        this._tiles.delete(viewerId);
      }, 300);
    }

    if (this._expandedStudentId === viewerId) {
      this._closeExpandedView();
    }

    this._updateCount();
  }


  // ── DOM BUILDER ───────────────────────────────────────────────

  /**
   * Build the full dashboard overlay.
   */
  _buildOverlay(roomKey) {
    this.$overlay = document.createElement('div');
    this.$overlay.className = 'teacher-dashboard';
    this.$overlay.id = 'teacher-dashboard';

    // ── Header ──
    this.$header = document.createElement('div');
    this.$header.className = 'teacher-dashboard__header';

    // Left side: title + count
    const headerLeft = document.createElement('div');
    headerLeft.className = 'teacher-dashboard__header-left';

    const title = document.createElement('h2');
    title.className = 'teacher-dashboard__title';
    title.textContent = 'CLASSROOM';

    const roomBadge = document.createElement('span');
    roomBadge.className = 'teacher-dashboard__room-badge';
    roomBadge.textContent = roomKey;

    this.$countLabel = document.createElement('span');
    this.$countLabel.className = 'teacher-dashboard__count';
    this.$countLabel.textContent = '0 students';

    headerLeft.appendChild(title);
    headerLeft.appendChild(roomBadge);
    headerLeft.appendChild(this.$countLabel);

    // Right side: search + close
    const headerRight = document.createElement('div');
    headerRight.className = 'teacher-dashboard__header-right';

    // Search input
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'teacher-dashboard__search-wrapper';

    const searchIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    searchIcon.setAttribute('width', '14');
    searchIcon.setAttribute('height', '14');
    searchIcon.setAttribute('viewBox', '0 0 14 14');
    searchIcon.setAttribute('fill', 'none');
    searchIcon.classList.add('teacher-dashboard__search-icon');
    const searchPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    searchPath.setAttribute('d', 'M6 11A5 5 0 106 1a5 5 0 000 10zM13 13l-3.5-3.5');
    searchPath.setAttribute('stroke', 'currentColor');
    searchPath.setAttribute('stroke-width', '1.3');
    searchPath.setAttribute('stroke-linecap', 'round');
    searchIcon.appendChild(searchPath);

    this.$searchInput = document.createElement('input');
    this.$searchInput.className = 'teacher-dashboard__search';
    this.$searchInput.type = 'text';
    this.$searchInput.placeholder = 'Search students...';
    this.$searchInput.addEventListener('input', (e) => {
      this._searchFilter = e.target.value.toLowerCase();
      this._filterTiles();
    });

    searchWrapper.appendChild(searchIcon);
    searchWrapper.appendChild(this.$searchInput);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'teacher-dashboard__close-btn';
    closeBtn.textContent = 'Close Dashboard';
    closeBtn.addEventListener('click', () => {
      if (this.onClose) this.onClose();
      this.hide();
    });

    headerRight.appendChild(searchWrapper);
    headerRight.appendChild(closeBtn);

    this.$header.appendChild(headerLeft);
    this.$header.appendChild(headerRight);

    // ── Grid ──
    this.$grid = document.createElement('div');
    this.$grid.className = 'teacher-dashboard__grid';
    this.$grid.id = 'teacher-dashboard-grid';

    // Empty state
    const emptyState = document.createElement('div');
    emptyState.className = 'teacher-dashboard__empty';
    emptyState.id = 'teacher-dashboard-empty';

    const emptyTitle = document.createElement('h3');
    emptyTitle.textContent = 'Waiting for students...';

    const emptyDesc = document.createElement('p');
    emptyDesc.textContent = 'Students will appear here when they connect to your room.';

    emptyState.appendChild(emptyTitle);
    emptyState.appendChild(emptyDesc);

    // ── Expanded view container (hidden by default) ──
    this.$expandedView = document.createElement('div');
    this.$expandedView.className = 'teacher-dashboard__expanded';
    this.$expandedView.id = 'teacher-dashboard-expanded';

    // ── Assemble ──
    this.$overlay.appendChild(this.$header);
    this.$overlay.appendChild(emptyState);
    this.$overlay.appendChild(this.$grid);
    this.$overlay.appendChild(this.$expandedView);
  }


  // ── TILE MANAGEMENT ───────────────────────────────────────────

  /**
   * Add a new student tile to the grid.
   */
  _addTile(student) {
    const tile = document.createElement('div');
    tile.className = 'teacher-dashboard__tile';
    tile.id = `tile-${student.id}`;
    tile.dataset.studentId = student.id;

    // ── Tile header ──
    const tileHeader = document.createElement('div');
    tileHeader.className = 'teacher-dashboard__tile-header';

    const nameLabel = document.createElement('span');
    nameLabel.className = 'teacher-dashboard__tile-name';
    nameLabel.textContent = student.name;

    const statusDot = document.createElement('span');
    statusDot.className = 'teacher-dashboard__tile-status';
    statusDot.id = `tile-status-${student.id}`;

    const fileLabel = document.createElement('span');
    fileLabel.className = 'teacher-dashboard__tile-file';
    fileLabel.id = `tile-file-${student.id}`;
    fileLabel.textContent = student.fileName;

    tileHeader.appendChild(nameLabel);
    tileHeader.appendChild(statusDot);
    tileHeader.appendChild(fileLabel);

    // ── Code preview ──
    const codePreview = document.createElement('pre');
    codePreview.className = 'teacher-dashboard__tile-code';
    codePreview.id = `tile-code-${student.id}`;
    codePreview.textContent = student.code || '# No code yet';

    // ── Tile footer ──
    const tileFooter = document.createElement('div');
    tileFooter.className = 'teacher-dashboard__tile-footer';

    const errorBadge = document.createElement('span');
    errorBadge.className = 'teacher-dashboard__tile-errors';
    errorBadge.id = `tile-errors-${student.id}`;
    errorBadge.textContent = '0 errors';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'teacher-dashboard__tile-expand';
    expandBtn.textContent = 'Expand';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openExpandedView(student.id);
    });

    tileFooter.appendChild(errorBadge);
    tileFooter.appendChild(expandBtn);

    // ── Assemble tile ──
    tile.appendChild(tileHeader);
    tile.appendChild(codePreview);
    tile.appendChild(tileFooter);

    // Click to expand
    tile.addEventListener('click', () => {
      this._openExpandedView(student.id);
    });

    // Entrance animation
    tile.style.opacity = '0';
    tile.style.transform = 'translateY(12px) scale(0.96)';

    this.$grid.appendChild(tile);
    this._tiles.set(student.id, tile);

    // Animate in
    requestAnimationFrame(() => {
      tile.style.transition = 'opacity 0.3s ease-out, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
      tile.style.opacity = '1';
      tile.style.transform = 'translateY(0) scale(1)';
    });

    // Hide empty state
    const emptyState = document.getElementById('teacher-dashboard-empty');
    if (emptyState) emptyState.style.display = 'none';
  }

  /**
   * Update a student tile with latest state.
   */
  _updateTile(viewerId) {
    const student = this._students.get(viewerId);
    if (!student) return;

    // Code preview
    const codeEl = document.getElementById(`tile-code-${viewerId}`);
    if (codeEl) {
      const lines = (student.code || '').split('\n');
      const preview = lines.slice(0, MAX_PREVIEW_LINES).join('\n');
      const highlighted = this._highlightPythonMini(
        preview.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      );
      codeEl.innerHTML = highlighted;
      if (lines.length > MAX_PREVIEW_LINES) {
        codeEl.innerHTML += '\n<span class="td-more">... +' + (lines.length - MAX_PREVIEW_LINES) + ' more lines</span>';
      }
    }

    // Status dot
    const statusEl = document.getElementById(`tile-status-${viewerId}`);
    if (statusEl) {
      statusEl.className = 'teacher-dashboard__tile-status';
      if (student.isRunning) {
        statusEl.classList.add('running');
      } else if (student.errors && student.errors.length > 0) {
        statusEl.classList.add('has-errors');
      } else {
        statusEl.classList.add('idle');
      }
    }

    // File name
    const fileEl = document.getElementById(`tile-file-${viewerId}`);
    if (fileEl) fileEl.textContent = student.fileName || 'main.py';

    // Error count
    const errEl = document.getElementById(`tile-errors-${viewerId}`);
    if (errEl) {
      const count = (student.errors || []).length;
      errEl.textContent = `${count} error${count !== 1 ? 's' : ''}`;
      errEl.classList.toggle('has-errors', count > 0);
    }
  }

  /**
   * Update all tiles (periodic refresh).
   */
  _updateAllTiles() {
    for (const [id] of this._students) {
      this._updateTile(id);
    }
  }


  // ── SEARCH / FILTER ───────────────────────────────────────────

  _filterTiles() {
    for (const [id, tile] of this._tiles) {
      const student = this._students.get(id);
      if (!student) continue;

      const match = !this._searchFilter ||
        student.name.toLowerCase().includes(this._searchFilter) ||
        student.fileName.toLowerCase().includes(this._searchFilter);

      tile.style.display = match ? '' : 'none';
    }
  }


  // ── EXPANDED VIEW ─────────────────────────────────────────────

  /**
   * Open the expanded view for a student.
   */
  _openExpandedView(studentId) {
    const student = this._students.get(studentId);
    if (!student || !this.$expandedView) return;

    this._expandedStudentId = studentId;

    // Build expanded content
    this.$expandedView.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'teacher-dashboard__expanded-header';

    const backBtn = document.createElement('button');
    backBtn.className = 'teacher-dashboard__expanded-back';
    backBtn.textContent = 'Back to Grid';
    backBtn.addEventListener('click', () => this._closeExpandedView());

    const nameLabel = document.createElement('h3');
    nameLabel.className = 'teacher-dashboard__expanded-name';
    nameLabel.textContent = student.name;

    const fileLabel = document.createElement('span');
    fileLabel.className = 'teacher-dashboard__expanded-file';
    fileLabel.textContent = student.fileName;

    const statusLabel = document.createElement('span');
    statusLabel.className = 'teacher-dashboard__expanded-status';
    statusLabel.id = 'expanded-status';
    statusLabel.textContent = student.isRunning ? 'RUNNING' : 'IDLE';
    if (student.isRunning) statusLabel.classList.add('running');

    header.appendChild(backBtn);
    header.appendChild(nameLabel);
    header.appendChild(fileLabel);
    header.appendChild(statusLabel);

    // Full code view
    const codeWrapper = document.createElement('div');
    codeWrapper.className = 'teacher-dashboard__expanded-code-wrapper';

    const lineNumbers = document.createElement('div');
    lineNumbers.className = 'teacher-dashboard__expanded-line-numbers';
    lineNumbers.id = 'expanded-line-numbers';

    const codeArea = document.createElement('pre');
    codeArea.className = 'teacher-dashboard__expanded-code';
    codeArea.id = 'expanded-code';

    codeWrapper.appendChild(lineNumbers);
    codeWrapper.appendChild(codeArea);

    // Error list
    const errorSection = document.createElement('div');
    errorSection.className = 'teacher-dashboard__expanded-errors';
    errorSection.id = 'expanded-errors';

    // Assemble
    this.$expandedView.appendChild(header);
    this.$expandedView.appendChild(codeWrapper);
    this.$expandedView.appendChild(errorSection);

    // Populate
    this._updateExpandedView(student);

    // Show expanded, hide grid
    this.$expandedView.classList.add('visible');
    this.$grid.classList.add('hidden');
  }

  /**
   * Close the expanded view.
   */
  _closeExpandedView() {
    this._expandedStudentId = null;

    if (this.$expandedView) {
      this.$expandedView.classList.remove('visible');
    }
    if (this.$grid) {
      this.$grid.classList.remove('hidden');
    }
  }

  /**
   * Update the expanded view with student state.
   */
  _updateExpandedView(student) {
    const codeEl = document.getElementById('expanded-code');
    const lineNumEl = document.getElementById('expanded-line-numbers');
    const errorsEl = document.getElementById('expanded-errors');
    const statusEl = document.getElementById('expanded-status');

    if (codeEl) {
      const escaped = (student.code || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      codeEl.innerHTML = this._highlightPythonFull(escaped);
    }

    if (lineNumEl) {
      const lineCount = ((student.code || '').match(/\n/g) || []).length + 1;
      const nums = [];
      for (let i = 1; i <= lineCount; i++) {
        nums.push(`<span>${i}</span>`);
      }
      lineNumEl.innerHTML = nums.join('\n');
    }

    if (errorsEl) {
      if (student.errors && student.errors.length > 0) {
        errorsEl.innerHTML = student.errors.map((e) => {
          const escapedMsg = (e.message || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return `<div class="teacher-dashboard__error-item">
            <span class="teacher-dashboard__error-line">Line ${e.line || '?'}</span>
            <span class="teacher-dashboard__error-msg">${escapedMsg}</span>
          </div>`;
        }).join('');
      } else {
        errorsEl.innerHTML = '<div class="teacher-dashboard__no-errors">No errors</div>';
      }
    }

    if (statusEl) {
      statusEl.textContent = student.isRunning ? 'RUNNING' : 'IDLE';
      statusEl.classList.toggle('running', student.isRunning);
    }
  }


  // ── COUNT ─────────────────────────────────────────────────────

  _updateCount() {
    if (this.$countLabel) {
      const count = this._students.size;
      this.$countLabel.textContent = `${count} student${count !== 1 ? 's' : ''}`;
    }

    // Show/hide empty state
    const emptyState = document.getElementById('teacher-dashboard-empty');
    if (emptyState) {
      emptyState.style.display = this._students.size === 0 ? 'flex' : 'none';
    }
  }


  // ── SYNTAX HIGHLIGHTING ───────────────────────────────────────

  /**
   * Mini Python highlighting for tile previews.
   */
  _highlightPythonMini(code) {
    // Keywords
    code = code.replace(
      /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|raise|pass|break|continue|yield|lambda|and|or|not|in|is|True|False|None)\b/g,
      '<span class="td-kw">$1</span>'
    );
    // Comments
    code = code.replace(/(#.*?)$/gm, '<span class="td-comment">$1</span>');
    // Strings
    code = code.replace(/('(?:[^'\\]|\\.)*?')/g, '<span class="td-str">$1</span>');
    // Numbers
    code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="td-num">$1</span>');
    return code;
  }

  /**
   * Full Python highlighting for expanded view.
   */
  _highlightPythonFull(code) {
    code = code.replace(
      /\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|raise|pass|break|continue|yield|lambda|and|or|not|in|is|True|False|None|global|nonlocal|assert|del|async|await)\b/g,
      '<span class="td-kw">$1</span>'
    );
    code = code.replace(/('(?:[^'\\]|\\.)*?')/g, '<span class="td-str">$1</span>');
    code = code.replace(/(#.*?)$/gm, '<span class="td-comment">$1</span>');
    code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="td-num">$1</span>');
    code = code.replace(
      /\b(print|len|range|int|str|float|list|dict|set|tuple|type|input|open|sorted|map|filter|zip|enumerate|super|isinstance)\b/g,
      '<span class="td-builtin">$1</span>'
    );
    code = code.replace(/(@\w+)/g, '<span class="td-decorator">$1</span>');
    return code;
  }
}

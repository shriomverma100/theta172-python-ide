/**
 * THETA172 — Classroom UI Builder v2 (Overhauled)
 * - CodeMirror containers instead of plain text viewers
 * - In-editor classroom toolbar (no panel navigation needed)
 * - Full-height connected/live views
 * - One-time permission with revoke
 * - Smooth micro-interaction ready
 */

// ── Helper ────────────────────────────────────────────────────────
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Base Structure ────────────────────────────────────────────────
export function buildBaseStructure(onBack) {
  const fragment = document.createDocumentFragment();

  // Background Structural Graphics
  const bg = el('div', 'cr-bg-structure');
  bg.id = 'cr-bg-structure';
  bg.innerHTML = `
    <div class="cr-red-block"></div>
    <div class="cr-giant-text">class.</div>
    <div class="cr-rotated-text">001</div>
    <div class="cr-vertical-meta">THETA / LAN_SYNC / V.02</div>
  `;
  fragment.appendChild(bg);

  const wrapper = el('div', 'cr-content-wrapper');

  // Top Nav
  const topbar = el('div', 'cr-topbar');
  topbar.innerHTML = `
    <div class="cr-nav-left">
      <button class="cr-back-btn" id="cr-global-back"><- EXIT</button>
      <span class="cr-nav-item">THETA172</span>
      <span class="cr-nav-item">CLASSROOM</span>
    </div>
    <div class="cr-nav-right">
      <span class="cr-nav-item" id="cr-status">STANDBY</span>
      <div class="cr-window-controls">
        <button class="cr-wc-btn cr-wc-minimize" id="cr-wc-min" title="Minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6H10" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="cr-wc-btn cr-wc-maximize" id="cr-wc-max" title="Maximize">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
        </button>
        <button class="cr-wc-btn cr-wc-close" id="cr-wc-close" title="Close">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>
  `;
  wrapper.appendChild(topbar);

  // Meta Text Blocks (Decorative)
  const metaBlocks = el('div', 'cr-meta-blocks');
  metaBlocks.id = 'cr-meta-blocks';
  metaBlocks.innerHTML = `
    <div class="cr-meta-block">
      <div class="cr-meta-title">X/LABS</div>
      <div class="cr-meta-desc">FOR AUTHENTICATION OF X/LABS UNREAL SPRING/SUMMER COLLECTION AND PROTECTION</div>
    </div>
    <div class="cr-meta-block">
      <div class="cr-meta-title">SYNC_02</div>
      <div class="cr-meta-desc">ZERO LATENCY LAN BROADCAST SYSTEM DESIGNED FOR REAL-TIME CODE TRANSMISSION</div>
    </div>
  `;
  wrapper.appendChild(metaBlocks);

  // Interactive Area
  const interactive = el('div', 'cr-interactive-area');
  interactive.id = 'cr-interactive-area';
  wrapper.appendChild(interactive);

  fragment.appendChild(wrapper);

  // Wire back button and window controls
  setTimeout(() => {
    document.getElementById('cr-global-back')?.addEventListener('click', onBack);
    // Window control buttons for classroom panel
    document.getElementById('cr-wc-min')?.addEventListener('click', () => {
      if (window.electronAPI?.minimize) window.electronAPI.minimize();
    });
    document.getElementById('cr-wc-max')?.addEventListener('click', () => {
      if (window.electronAPI?.maximize) window.electronAPI.maximize();
    });
    document.getElementById('cr-wc-close')?.addEventListener('click', () => {
      if (window.electronAPI?.close) window.electronAPI.close();
    });
  }, 0);

  return fragment;
}

// ── Blur/Unblur Background ────────────────────────────────────────
function blurBackground() {
  document.getElementById('cr-bg-structure')?.classList.add('blurred');
  document.getElementById('cr-meta-blocks')?.classList.add('blurred');
}

function unblurBackground() {
  document.getElementById('cr-bg-structure')?.classList.remove('blurred');
  document.getElementById('cr-meta-blocks')?.classList.remove('blurred');
}

export { blurBackground, unblurBackground };

// ── Role Selector ─────────────────────────────────────────────────
export function buildRoleSelector(onSelectRole) {
  const wrap = el('div', 'cr-role-selector');

  const teacherBtn = el('button', 'cr-role-btn');
  teacherBtn.innerHTML = `<span>TEACHER</span> <div class="cr-arrow-box">-></div>`;
  teacherBtn.addEventListener('click', () => onSelectRole('teacher'));

  const studentBtn = el('button', 'cr-role-btn');
  studentBtn.innerHTML = `<span>STUDENT</span> <div class="cr-arrow-box">-></div>`;
  studentBtn.addEventListener('click', () => onSelectRole('student'));

  wrap.appendChild(teacherBtn);
  wrap.appendChild(studentBtn);
  return wrap;
}

// ── Teacher Panel ─────────────────────────────────────────────────
export function buildTeacherPanel({ onGoLive, onStopLive, onBack, onClosePanel }) {
  const panel = el('div', 'cr-teacher-panel');
  panel.style.width = '100%';
  panel.style.display = 'flex';
  panel.style.justifyContent = 'center';
  panel.style.alignItems = 'center';

  // Setup form with back button
  const setup = el('div', 'cr-setup');
  setup.id = 'cr-teacher-setup';
  setup.innerHTML = `
    <button class="cr-setup-back" id="cr-teacher-back"><- BACK</button>
    <div class="cr-input-group">
      <label class="cr-label">HOST_NAME</label>
      <input type="text" class="cr-input" id="cr-teacher-name" placeholder="PROF. SMITH" autocomplete="off" spellcheck="false" />
    </div>
    <button class="cr-action-btn" id="cr-go-live-btn">
      <span>GO_LIVE</span> <span>-></span>
    </button>
  `;

  // Live view — full-height student list with search
  const liveView = el('div', 'cr-live-view hidden');
  liveView.id = 'cr-live-view';
  liveView.innerHTML = `
    <div class="cr-panel-header">
      <div class="cr-panel-title">
        <span class="cr-live-indicator"></span>
        <span id="cr-live-teacher-name"></span>
        <span class="cr-student-count-badge" id="cr-student-count-badge">0</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="cr-close-panel-btn" id="cr-teacher-to-editor"><- EDITOR</button>
        <button class="cr-stop-btn" id="cr-stop-live-btn">[ STOP ]</button>
      </div>
    </div>
    <div class="cr-search-bar">
      <input type="text" class="cr-search-input" id="cr-student-search" placeholder="SEARCH STUDENTS..." autocomplete="off" spellcheck="false" />
    </div>
    <div class="cr-students-list" id="cr-students-list">
      <div class="cr-waiting-text">WAITING_FOR_CONNECTIONS...</div>
    </div>
    <div class="cr-chat-section">
      <div class="cr-chat-header">CLASS_CHAT</div>
      <div class="cr-chat-messages" id="cr-teacher-chat-messages"></div>
      <div class="cr-chat-input-area">
        <select class="cr-chat-target" id="cr-teacher-chat-target">
          <option value="broadcast">ALL STUDENTS</option>
        </select>
        <input type="text" class="cr-chat-input" id="cr-teacher-chat-input" placeholder="Type a message..." autocomplete="off">
        <button class="cr-chat-send" id="cr-teacher-chat-send">SEND</button>
      </div>
    </div>
  `;

  // Student code viewer — uses CodeMirror container + live output
  const codeViewer = el('div', 'cr-code-viewer hidden');
  codeViewer.id = 'cr-student-code-viewer';
  codeViewer.innerHTML = `
    <div class="cr-panel-header">
      <button class="cr-stop-btn" id="cr-code-viewer-back"><- BACK</button>
      <div class="cr-panel-title" id="cr-code-viewer-name" style="font-size: 14px;"></div>
      <div class="cr-edit-status" id="cr-edit-status"></div>
    </div>
    <div class="cr-file-bar">
      FILE: <span id="cr-viewer-filename">MAIN.PY</span>
    </div>
    <div class="cr-live-editor-container" id="cr-student-live-editor"></div>
    <div class="cr-terminal-section">
      <div class="cr-terminal-header">STUDENT_OUTPUT</div>
      <pre class="cr-terminal-output" id="cr-student-terminal-output"></pre>
    </div>
    <div class="cr-code-actions">
      <button class="cr-action-btn cr-action-btn--sm" id="cr-request-edit-btn">REQUEST_EDIT</button>
      <button class="cr-action-btn cr-action-btn--sm cr-action-btn--push hidden" id="cr-push-edit-btn">PUSH_EDITS</button>
    </div>
  `;

  panel.appendChild(setup);
  panel.appendChild(liveView);
  panel.appendChild(codeViewer);

  setTimeout(() => {
    document.getElementById('cr-teacher-back')?.addEventListener('click', onBack);
    document.getElementById('cr-go-live-btn')?.addEventListener('click', () => {
      const name = document.getElementById('cr-teacher-name')?.value?.trim();
      if (name) onGoLive(name);
    });
    document.getElementById('cr-stop-live-btn')?.addEventListener('click', onStopLive);
    document.getElementById('cr-teacher-to-editor')?.addEventListener('click', onClosePanel);
    document.getElementById('cr-teacher-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = e.target.value?.trim();
        if (name) onGoLive(name);
      }
    });
  }, 0);

  return panel;
}

// ── Student Panel ─────────────────────────────────────────────────
export function buildStudentPanel({ onJoin, onRaiseHand, onDisconnect, onBack, onClosePanel }) {
  const panel = el('div', 'cr-student-panel');
  panel.style.width = '100%';
  panel.style.display = 'flex';
  panel.style.justifyContent = 'center';
  panel.style.alignItems = 'center';

  // Setup form with back button
  const setup = el('div', 'cr-setup');
  setup.id = 'cr-student-setup';
  setup.innerHTML = `
    <button class="cr-setup-back" id="cr-student-back"><- BACK</button>
    <div class="cr-input-group">
      <label class="cr-label">USER_NAME</label>
      <input type="text" class="cr-input" id="cr-student-name" placeholder="JOHN DOE" autocomplete="off" spellcheck="false" />
    </div>
    <div class="cr-input-group">
      <label class="cr-label">USER_ID (ROLL)</label>
      <input type="text" class="cr-input" id="cr-student-roll" placeholder="ID-001" autocomplete="off" spellcheck="false" />
    </div>
    <button class="cr-action-btn" id="cr-join-btn">
      <span>CONNECT</span> <span>-></span>
    </button>
  `;

  // Discovery state
  const discovery = el('div', 'cr-discovery hidden');
  discovery.id = 'cr-discovery';
  discovery.innerHTML = `<span id="cr-discovery-text">SEARCHING...</span>`;

  // Connected view — full-height with CodeMirror live editor + terminal
  const connected = el('div', 'cr-connected-view hidden');
  connected.id = 'cr-connected-view';
  connected.innerHTML = `
    <div class="cr-panel-header">
      <div class="cr-panel-title">
        <span class="cr-live-indicator"></span>
        <span id="cr-connected-teacher"></span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="cr-close-panel-btn" id="cr-student-to-editor"><- EDITOR</button>
        <button class="cr-stop-btn" id="cr-disconnect-btn">[ DISCONNECT ]</button>
      </div>
    </div>
    <div class="cr-file-bar">
      FILE: <span id="cr-teacher-filename">MAIN.PY</span>
      <span class="cr-cursor-indicator" id="cr-cursor-indicator">Ln 1, Col 1</span>
    </div>
    <div class="cr-live-editor-container" id="cr-teacher-live-editor"></div>
    <div class="cr-terminal-section">
      <div class="cr-terminal-header">TERMINAL_OUTPUT</div>
      <pre class="cr-terminal-output" id="cr-terminal-output"></pre>
    </div>
    <div class="cr-code-actions">
      <button class="cr-action-btn cr-action-btn--hand" id="cr-raise-hand-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.8L2.3 16.7a1 1 0 0 1 .3-1.5l.5-.3c.6-.4 1.5-.3 2 .3L6 16"/></svg>
        RAISE HAND
      </button>
    </div>
    <div class="cr-chat-section">
      <div class="cr-chat-header">CHAT</div>
      <div class="cr-chat-messages" id="cr-student-chat-messages"></div>
      <div class="cr-chat-input-area">
        <select class="cr-chat-target" id="cr-student-chat-target">
          <option value="teacher">TEACHER</option>
          <option value="broadcast">ALL</option>
        </select>
        <input type="text" class="cr-chat-input" id="cr-student-chat-input" placeholder="Type a message..." autocomplete="off">
        <button class="cr-chat-send" id="cr-student-chat-send">SEND</button>
      </div>
    </div>
  `;

  // Edit permission dialog — overlay with blur
  const editOverlay = el('div', 'cr-edit-dialog-overlay hidden');
  editOverlay.id = 'cr-edit-dialog-overlay';
  const editDialog = el('div', 'cr-edit-dialog');
  editDialog.id = 'cr-edit-dialog';
  editDialog.innerHTML = `
    <div class="cr-dialog-icon">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect x="2" y="2" width="28" height="28" rx="4" stroke="currentColor" stroke-width="2"/>
        <path d="M20 8L24 12L14 22H10V18L20 8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
    </div>
    <h3>ACCESS_REQUEST</h3>
    <div class="cr-dialog-desc">TEACHER IS REQUESTING EDIT PERMISSION FOR YOUR CODE</div>
    <div class="cr-dialog-note">You can revoke access anytime from the editor toolbar</div>
    <div class="cr-dialog-btns">
      <button class="cr-action-btn cr-action-btn--allow" id="cr-grant-edit">ALLOW</button>
      <button class="cr-stop-btn" id="cr-deny-edit">DENY</button>
    </div>
  `;
  editOverlay.appendChild(editDialog);

  panel.appendChild(setup);
  panel.appendChild(discovery);
  panel.appendChild(connected);
  panel.appendChild(editOverlay);

  setTimeout(() => {
    document.getElementById('cr-student-back')?.addEventListener('click', onBack);
    document.getElementById('cr-join-btn')?.addEventListener('click', () => {
      const name = document.getElementById('cr-student-name')?.value?.trim();
      const roll = document.getElementById('cr-student-roll')?.value?.trim();
      if (name && roll) onJoin(name, roll);
    });
    document.getElementById('cr-raise-hand-btn')?.addEventListener('click', () => {
      onRaiseHand('HELP_REQ');
    });
    document.getElementById('cr-disconnect-btn')?.addEventListener('click', onDisconnect);
    document.getElementById('cr-student-to-editor')?.addEventListener('click', onClosePanel);
    // Enter key on roll input to join
    document.getElementById('cr-student-roll')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const name = document.getElementById('cr-student-name')?.value?.trim();
        const roll = e.target.value?.trim();
        if (name && roll) onJoin(name, roll);
      }
    });
  }, 0);

  return panel;
}

// ── Student Card (for teacher's list) ──────────────────────────────
export function buildStudentCard({ id, name, roll, helpRequested, editPermission, onViewCode }) {
  const card = el('div', 'cr-student-item' + (helpRequested ? ' help' : ''));
  card.dataset.studentId = id;

  card.innerHTML = `
    <div class="cr-student-info">
      <span class="cr-student-name">${escapeHtml(name)}</span>
      <span class="cr-student-roll">ID: ${escapeHtml(roll)}</span>
    </div>
    <div class="cr-student-badges">
      ${helpRequested ? '<div class="cr-badge cr-badge--alert">[ ALERT ]</div>' : ''}
      ${editPermission ? '<div class="cr-badge cr-badge--edit">EDITING</div>' : ''}
    </div>
    <button class="cr-view-btn cr-view-code-btn">VIEW_SRC</button>
  `;

  card.querySelector('.cr-view-code-btn')?.addEventListener('click', () => onViewCode(id, name, roll));
  return card;
}

// ── In-Editor Classroom Toolbar ────────────────────────────────────
export function buildEditorToolbar(role, callbacks) {
  const toolbar = el('div', 'cr-editor-toolbar');
  toolbar.id = 'cr-editor-toolbar';

  if (role === 'teacher') {
    toolbar.innerHTML = `
      <div class="cr-toolbar-left">
        <span class="cr-toolbar-live-dot"></span>
        <span class="cr-toolbar-label">LIVE</span>
        <span class="cr-toolbar-sep">|</span>
        <span class="cr-toolbar-students" id="cr-toolbar-student-count">0 students</span>
      </div>
      <div class="cr-toolbar-right">
        <button class="cr-toolbar-btn" id="cr-toolbar-view-panel" title="Open classroom panel">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M4 5H10M4 7H8M4 9H6" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/></svg>
          PANEL
        </button>
        <button class="cr-toolbar-btn cr-toolbar-btn--stop" id="cr-toolbar-stop" title="Stop session">STOP</button>
      </div>
    `;

    setTimeout(() => {
      document.getElementById('cr-toolbar-view-panel')?.addEventListener('click', () => callbacks.onOpenPanel?.());
      document.getElementById('cr-toolbar-stop')?.addEventListener('click', () => callbacks.onStop?.());
    }, 0);

  } else if (role === 'student') {
      toolbar.innerHTML = `
      <div class="cr-toolbar-left">
        <span class="cr-toolbar-live-dot"></span>
        <span class="cr-toolbar-label" id="cr-toolbar-teacher-name">CONNECTED</span>
      </div>
      <div class="cr-toolbar-right">
        <button class="cr-toolbar-btn cr-toolbar-btn--revoke hidden" id="cr-toolbar-revoke" title="Revoke teacher edit access">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          REVOKE EDIT
        </button>
        <button class="cr-toolbar-btn" id="cr-toolbar-raise-hand" title="Raise hand for help">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.8L2.3 16.7a1 1 0 0 1 .3-1.5l.5-.3c.6-.4 1.5-.3 2 .3L6 16"/></svg>
          HAND
        </button>
        <button class="cr-toolbar-btn" id="cr-toolbar-open-panel" title="Open classroom panel">PANEL</button>
        <button class="cr-toolbar-btn cr-toolbar-btn--stop" id="cr-toolbar-disconnect" title="Disconnect">LEAVE</button>
      </div>
    `;

    setTimeout(() => {
      document.getElementById('cr-toolbar-revoke')?.addEventListener('click', () => callbacks.onRevoke?.());
      document.getElementById('cr-toolbar-raise-hand')?.addEventListener('click', () => callbacks.onRaiseHand?.());
      document.getElementById('cr-toolbar-open-panel')?.addEventListener('click', () => callbacks.onOpenPanel?.());
      document.getElementById('cr-toolbar-disconnect')?.addEventListener('click', () => callbacks.onDisconnect?.());
    }, 0);
  }

  return toolbar;
}

// ── Show/Hide Revoke Button ────────────────────────────────────────
export function showRevokeButton(show) {
  const btn = document.getElementById('cr-toolbar-revoke');
  if (btn) {
    if (show) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }
}

// ── Update Toolbar Student Count ───────────────────────────────────
export function updateToolbarStudentCount(count) {
  const el = document.getElementById('cr-toolbar-student-count');
  if (el) el.textContent = `${count} student${count !== 1 ? 's' : ''}`;
  const badge = document.getElementById('cr-student-count-badge');
  if (badge) badge.textContent = count;
}

// ── Update Toolbar Teacher Name ────────────────────────────────────
export function updateToolbarTeacherName(name) {
  const el = document.getElementById('cr-toolbar-teacher-name');
  if (el) el.textContent = name;
}

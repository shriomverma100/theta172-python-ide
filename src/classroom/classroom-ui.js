/**
 * THETA172 — Classroom UI (Blackout).
 * Builds the markup for the classroom screen: role choice, teacher setup and
 * live dashboard, student setup and live view, the edit-permission dialog,
 * and the small classroom toolbar shown inside the editor.
 * Element ids are the contract with classroom.js; keep them stable.
 * Anything that comes from the network is inserted as text, never as HTML.
 */

import { JOIN_ICONS } from './relay-art.js';

// ── Helpers ───────────────────────────────────────────────────────
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html; // trusted, static markup only
  return e;
}

function textEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

const BACK_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7 2L3 6L7 10" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>';
const CLOSE_ICON = '<svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true"><path d="M1 1L10 10M10 1L1 10" stroke="currentColor" stroke-width="1.2"/></svg>';
const MARK = `<svg class="cr-brand__mark" width="28" height="24" viewBox="0 0 210 180" aria-hidden="true">
  <rect x="0" y="60" width="130" height="40" fill="#FF4A36"/><rect x="45" y="100" width="45" height="80" fill="#FF4A36"/>
  <rect x="135" y="100" width="38" height="80" fill="#FF4A36"/><rect x="141" y="36" width="24" height="24" fill="#FF4A36"/>
  <rect x="173" y="0" width="32" height="32" fill="#FF4A36"/></svg>`;

// ── Base structure ────────────────────────────────────────────────
export function buildBaseStructure(onBack) {
  const fragment = document.createDocumentFragment();
  const wrapper = el('div', 'cr-content-wrapper');

  const topbar = el('header', 'cr-topbar');
  topbar.innerHTML = `
    <div class="cr-nav-left">
      <button class="cr-back-btn" id="cr-global-back" type="button" title="Back to the editor (Esc)">${BACK_ICON}<span>Editor</span></button>
      <div class="cr-brand">${MARK}<span class="cr-brand__name">Classroom</span></div>
    </div>
    <div class="cr-nav-right">
      <span class="cr-status" role="status"><span class="cr-status__dot" aria-hidden="true"></span><span id="cr-status">Not connected</span></span>
      <div class="cr-window-controls">
        <button class="wc-btn" id="cr-wc-min" type="button" title="Minimize" aria-label="Minimize"><svg width="11" height="1" viewBox="0 0 11 1" aria-hidden="true"><rect width="11" height="1" fill="currentColor"/></svg></button>
        <button class="wc-btn" id="cr-wc-max" type="button" title="Maximize" aria-label="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" stroke="currentColor" fill="none"/></svg></button>
        <button class="wc-btn wc-close" id="cr-wc-close" type="button" title="Close" aria-label="Close">${CLOSE_ICON}</button>
      </div>
    </div>
  `;
  wrapper.appendChild(topbar);

  const interactive = el('main', 'cr-interactive-area');
  interactive.id = 'cr-interactive-area';
  wrapper.appendChild(interactive);
  fragment.appendChild(wrapper);

  setTimeout(() => {
    document.getElementById('cr-global-back')?.addEventListener('click', onBack);
    document.getElementById('cr-wc-min')?.addEventListener('click', () => window.electronAPI?.minimize?.());
    document.getElementById('cr-wc-max')?.addEventListener('click', () => window.electronAPI?.maximize?.());
    document.getElementById('cr-wc-close')?.addEventListener('click', () => window.electronAPI?.close?.());
  }, 0);

  return fragment;
}

// The old design blurred decorative graphics behind forms; Blackout has none.
export function blurBackground() {}
export function unblurBackground() {}

// ── Role choice ───────────────────────────────────────────────────
export function buildRoleSelector(onSelectRole) {
  const wrap = el('section', 'cr-role-selector');
  wrap.innerHTML = `
    <div class="cr-intro">
      <h1 class="cr-title">Classroom</h1>
      <p class="cr-lead">Teach a class or join one. On the same Wi-Fi it just works; from anywhere else, students paste the teacher's invite.</p>
    </div>
    <div class="cr-role-grid">
      <button class="cr-role-btn" type="button" data-role="teacher">
        <span class="cr-role-btn__kicker"><span class="px-mark" aria-hidden="true"></span>Teacher</span>
        <span class="cr-role-btn__title">Start a class</span>
        <span class="cr-role-btn__desc">See every student's code live, answer help requests and message the class.</span>
        <span class="cr-role-btn__go" aria-hidden="true">Start →</span>
      </button>
      <button class="cr-role-btn" type="button" data-role="student">
        <span class="cr-role-btn__kicker"><span class="px-mark" aria-hidden="true"></span>Student</span>
        <span class="cr-role-btn__title">Join a class</span>
        <span class="cr-role-btn__desc">Follow your teacher's code as they type and ask for help when you are stuck.</span>
        <span class="cr-role-btn__go" aria-hidden="true">Join →</span>
      </button>
    </div>
  `;
  wrap.querySelectorAll('[data-role]').forEach((btn) => {
    btn.addEventListener('click', () => onSelectRole(btn.dataset.role));
  });
  return wrap;
}

// ── Shared pieces ─────────────────────────────────────────────────
const outputSection = (headerText, preId) => `
  <section class="cr-terminal-section" aria-label="${headerText}">
    <div class="cr-terminal-header">${headerText}</div>
    <pre class="cr-terminal-output" id="${preId}"></pre>
  </section>`;

const chatSection = (title, prefix, options) => `
  <section class="cr-chat-section" aria-label="${title}">
    <div class="cr-chat-header">${title}</div>
    <div class="cr-chat-messages" id="cr-${prefix}-chat-messages" role="log" aria-live="polite"></div>
    <div class="cr-chat-input-area">
      <label class="sr-only" for="cr-${prefix}-chat-target">Send to</label>
      <select class="cr-chat-target" id="cr-${prefix}-chat-target">${options}</select>
      <label class="sr-only" for="cr-${prefix}-chat-input">Message</label>
      <input type="text" class="cr-chat-input" id="cr-${prefix}-chat-input" placeholder="Write a message" autocomplete="off" maxlength="2000">
      <button class="cr-chat-send" id="cr-${prefix}-chat-send" type="button">Send</button>
    </div>
  </section>`;

// ── Teacher ───────────────────────────────────────────────────────
export function buildTeacherPanel({ onGoLive, onStopLive, onBack, onClosePanel }) {
  const panel = el('div', 'cr-teacher-panel');

  const setup = el('section', 'cr-setup');
  setup.id = 'cr-teacher-setup';
  setup.innerHTML = `
    <button class="cr-setup-back" id="cr-teacher-back" type="button">${BACK_ICON}<span>Back</span></button>
    <h2 class="cr-setup-title">Start a class</h2>
    <p class="cr-setup-lead">Students on this Wi-Fi always find your class. Choose how everyone else joins.</p>
    <div class="cr-input-group">
      <label class="cr-label" for="cr-teacher-name">Your name</label>
      <input type="text" class="cr-input" id="cr-teacher-name" placeholder="e.g. Ms. Sharma" autocomplete="off" spellcheck="false" maxlength="64" />
      <span class="cr-hint">Students see this name when they join.</span>
    </div>
    <fieldset class="cr-join-ways" id="cr-join-ways">
      <legend class="cr-label">How students join</legend>
      <label class="cr-way">
        <input type="radio" name="cr-join-way" value="wifi" />
        <span class="cr-way__icon">${JOIN_ICONS.wifi}</span>
        <span class="cr-way__words"><b>Same Wi-Fi only</b><small>Students in this room. Nothing to set up.</small></span>
      </label>
      <label class="cr-way">
        <input type="radio" name="cr-join-way" value="relay" />
        <span class="cr-way__icon">${JOIN_ICONS.relay}</span>
        <span class="cr-way__words"><b>From anywhere, with our school's relay</b><small>Home Wi-Fi, mobile data, another campus. Students paste your invite.</small></span>
      </label>
      <div class="cr-way__detail" id="cr-relay-detail">
        <label class="cr-label" for="cr-relay-url">School relay address</label>
        <div class="cr-relay-row">
          <input type="url" class="cr-input" id="cr-relay-url" placeholder="wss://theta172-relay.your-school.workers.dev" autocomplete="off" spellcheck="false" maxlength="300" />
          <button class="cr-action-btn cr-action-btn--ghost" id="cr-relay-test" type="button">Test</button>
        </div>
        <span class="cr-hint" id="cr-relay-hint">Ask the teacher or IT person who set it up, or set one up below.</span>
      </div>
      <button class="cr-way cr-way--setup" id="cr-relay-setup" type="button">
        <span class="cr-way__icon">${JOIN_ICONS.setup}</span>
        <span class="cr-way__words"><b>No relay yet? Set one up</b><small>Free on Cloudflare, about 10 minutes, once for the whole school. Step-by-step guide with pictures.</small></span>
        <span class="cr-way__go" aria-hidden="true">Open guide →</span>
      </button>
    </fieldset>
    <button class="cr-action-btn" id="cr-go-live-btn" type="button">Go live</button>
  `;

  const liveView = el('section', 'cr-live-view hidden');
  liveView.id = 'cr-live-view';
  liveView.innerHTML = `
    <div class="cr-panel-header">
      <div class="cr-panel-title">
        <span class="cr-live-indicator" aria-hidden="true"></span>
        <span class="cr-live-label">Live</span>
        <span id="cr-live-teacher-name"></span>
        <span class="cr-student-count-badge" title="Students connected"><span id="cr-student-count-badge">0</span> joined</span>
        <span class="cr-join-code hidden" id="cr-join-code" title="Students on other networks paste this invite into Classroom → Join a class"><span class="cr-join-code__label">Invite</span><span class="cr-join-code__value"></span><button class="cr-join-code__copy" id="cr-join-code-copy" type="button">Copy invite</button></span>
        <span class="cr-routes" id="cr-routes" role="status"></span>
      </div>
      <div class="cr-panel-actions">
        <button class="cr-close-panel-btn" id="cr-teacher-to-editor" type="button">Back to editor</button>
        <button class="cr-stop-btn" id="cr-stop-live-btn" type="button">End class</button>
      </div>
    </div>
    <div class="cr-share" id="cr-share" aria-label="Shared with the class"></div>
    <div class="cr-pulse" id="cr-pulse" aria-label="Class pulse"></div>
    <div class="cr-live-grid">
      <div class="cr-students-col">
        <div class="cr-search-bar">
          <label class="sr-only" for="cr-student-search">Search students</label>
          <input type="text" class="cr-search-input" id="cr-student-search" placeholder="Search by name or roll number" autocomplete="off" spellcheck="false" />
        </div>
        <div class="cr-students-list" id="cr-students-list">
          <div class="cr-waiting-text">Waiting for students to join…</div>
        </div>
      </div>
      ${chatSection('Class chat', 'teacher', '<option value="broadcast">Everyone</option>')}
    </div>
  `;

  const codeViewer = el('section', 'cr-code-viewer hidden');
  codeViewer.id = 'cr-student-code-viewer';
  codeViewer.innerHTML = `
    <div class="cr-panel-header">
      <div class="cr-panel-title">
        <button class="cr-close-panel-btn" id="cr-code-viewer-back" type="button">${BACK_ICON}<span>All students</span></button>
        <span class="cr-viewer-name" id="cr-code-viewer-name"></span>
      </div>
      <div class="cr-panel-actions">
        <span class="cr-edit-status" id="cr-edit-status" role="status"></span>
        <button class="cr-action-btn cr-action-btn--sm" id="cr-request-edit-btn" type="button">Ask to edit</button>
        <button class="cr-action-btn cr-action-btn--sm cr-action-btn--push hidden" id="cr-push-edit-btn" type="button">Send my edits</button>
      </div>
    </div>
    <div class="cr-file-bar"><span class="cr-file-bar__label">File</span><span id="cr-viewer-filename">main.py</span></div>
    <div class="cr-live-editor-container" id="cr-student-live-editor"></div>
    ${outputSection('Student output', 'cr-student-terminal-output')}
  `;

  panel.append(setup, liveView, codeViewer);

  setTimeout(() => {
    const goLive = () => {
      const name = document.getElementById('cr-teacher-name')?.value?.trim();
      if (name) onGoLive(name);
      else document.getElementById('cr-teacher-name')?.focus();
    };
    document.getElementById('cr-teacher-back')?.addEventListener('click', onBack);
    document.getElementById('cr-go-live-btn')?.addEventListener('click', goLive);
    document.getElementById('cr-stop-live-btn')?.addEventListener('click', onStopLive);
    document.getElementById('cr-teacher-to-editor')?.addEventListener('click', onClosePanel);
    document.getElementById('cr-teacher-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') goLive();
    });
  }, 0);

  return panel;
}

// ── Student ───────────────────────────────────────────────────────
export function buildStudentPanel({ onJoin, onRaiseHand, onDisconnect, onBack, onClosePanel, onDone, onHandIn }) {
  const panel = el('div', 'cr-student-panel');

  const setup = el('section', 'cr-setup');
  setup.id = 'cr-student-setup';
  setup.innerHTML = `
    <button class="cr-setup-back" id="cr-student-back" type="button">${BACK_ICON}<span>Back</span></button>
    <h2 class="cr-setup-title">Join a class</h2>
    <p class="cr-setup-lead">On your teacher's Wi-Fi the class is found by itself. Anywhere else, paste the invite your teacher shared.</p>
    <div class="cr-input-group">
      <label class="cr-label" for="cr-student-name">Your name</label>
      <input type="text" class="cr-input" id="cr-student-name" placeholder="e.g. Aarav Gupta" autocomplete="off" spellcheck="false" maxlength="64" />
    </div>
    <div class="cr-input-group">
      <label class="cr-label" for="cr-student-roll">Roll number</label>
      <input type="text" class="cr-input" id="cr-student-roll" placeholder="e.g. 12" autocomplete="off" spellcheck="false" maxlength="32" />
    </div>
    <div class="cr-input-group">
      <label class="cr-label" for="cr-join-code-input">Class invite <span class="cr-label__opt">only if you are not on the teacher's Wi-Fi</span></label>
      <input type="text" class="cr-input cr-input--code" id="cr-join-code-input" placeholder="e.g. K7M-4QX @ theta172-relay.school.workers.dev" autocomplete="off" spellcheck="false" maxlength="320" />
      <span class="cr-hint" id="cr-invite-hint">Paste the whole line your teacher shared, then press Join.</span>
    </div>
    <details class="cr-advanced">
      <summary>My teacher gave only a code</summary>
      <div class="cr-input-group">
        <label class="cr-label" for="cr-relay-url-student">School relay address</label>
        <input type="url" class="cr-input" id="cr-relay-url-student" placeholder="wss://theta172-relay.school.workers.dev" autocomplete="off" spellcheck="false" maxlength="300" />
        <span class="cr-hint">Type it once; the app remembers it for the next class.</span>
      </div>
    </details>
    <button class="cr-action-btn" id="cr-join-btn" type="button">Join</button>
  `;

  const discovery = el('section', 'cr-discovery hidden');
  discovery.id = 'cr-discovery';
  discovery.innerHTML = `
    <span class="cr-searching" aria-hidden="true"><span></span><span></span><span></span></span>
    <span id="cr-discovery-text" role="status">Looking for a class on this network…</span>
  `;

  const connected = el('section', 'cr-connected-view hidden');
  connected.id = 'cr-connected-view';
  connected.innerHTML = `
    <div class="cr-panel-header">
      <div class="cr-panel-title">
        <span class="cr-live-indicator" aria-hidden="true"></span>
        <span class="cr-live-label">Live</span>
        <span id="cr-connected-teacher"></span>
        <span class="cr-link-status" id="cr-link-status" role="status"></span>
        <span class="cr-share-status" id="cr-share-status"></span>
      </div>
      <div class="cr-panel-actions">
        <button class="cr-action-btn cr-action-btn--sm" id="cr-handin-btn" type="button" title="Answer a short viva about your code and hand it in">Hand in</button>
        <button class="cr-action-btn cr-action-btn--sm cr-done-btn" id="cr-done-btn" data-done-btn type="button" aria-pressed="false" title="Tell your teacher you have finished the task">I'm done</button>
        <button class="cr-action-btn cr-action-btn--sm cr-action-btn--hand" id="cr-raise-hand-btn" type="button"><span class="px-mark" aria-hidden="true"></span><span class="cr-hand-label">Ask for help</span></button>
        <button class="cr-close-panel-btn" id="cr-student-to-editor" type="button">Back to editor</button>
        <button class="cr-stop-btn" id="cr-disconnect-btn" type="button">Leave class</button>
      </div>
    </div>
    <div class="cr-connected-grid">
      <div class="cr-connected-main">
        <div class="cr-file-bar">
          <span class="cr-file-bar__label">Teacher's file</span><span id="cr-teacher-filename">main.py</span>
          <span class="cr-cursor-indicator" id="cr-cursor-indicator">Ln 1 · Col 1</span>
        </div>
        <div class="cr-live-editor-container" id="cr-teacher-live-editor"></div>
        ${outputSection("Teacher's output", 'cr-terminal-output')}
      </div>
      ${chatSection('Chat', 'student', '<option value="teacher">Teacher only</option><option value="broadcast">Everyone</option>')}
    </div>
  `;

  const editOverlay = el('div', 'cr-edit-dialog-overlay hidden');
  editOverlay.id = 'cr-edit-dialog-overlay';
  editOverlay.innerHTML = `
    <div class="cr-edit-dialog" id="cr-edit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cr-edit-dialog-title" aria-describedby="cr-edit-dialog-desc">
      <h3 id="cr-edit-dialog-title"><span class="px-mark" aria-hidden="true"></span>Your teacher wants to edit your code</h3>
      <p class="cr-dialog-desc" id="cr-edit-dialog-desc">If you allow it, your teacher can type in your editor while you watch.</p>
      <p class="cr-dialog-note">You can turn this off at any time with "Stop teacher editing" above your code.</p>
      <div class="cr-dialog-btns">
        <button class="cr-stop-btn" id="cr-deny-edit" type="button">Don't allow</button>
        <button class="cr-action-btn cr-action-btn--allow" id="cr-grant-edit" type="button">Allow</button>
      </div>
    </div>
  `;

  panel.append(setup, discovery, connected, editOverlay);

  setTimeout(() => {
    const join = () => {
      const name = document.getElementById('cr-student-name')?.value?.trim();
      const roll = document.getElementById('cr-student-roll')?.value?.trim();
      if (name && roll) onJoin(name, roll, document.getElementById('cr-join-code-input')?.value?.trim() || '');
      else document.getElementById(name ? 'cr-student-roll' : 'cr-student-name')?.focus();
    };
    document.getElementById('cr-student-back')?.addEventListener('click', onBack);
    document.getElementById('cr-join-btn')?.addEventListener('click', join);
    document.getElementById('cr-raise-hand-btn')?.addEventListener('click', () => onRaiseHand('HELP_REQ'));
    document.getElementById('cr-disconnect-btn')?.addEventListener('click', onDisconnect);
    document.getElementById('cr-done-btn')?.addEventListener('click', () => onDone?.());
    document.getElementById('cr-handin-btn')?.addEventListener('click', () => onHandIn?.());
    document.getElementById('cr-join-code-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    document.getElementById('cr-student-to-editor')?.addEventListener('click', onClosePanel);
    document.getElementById('cr-student-roll')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join();
    });
  }, 0);

  return panel;
}

// ── Student card (teacher's list) ─────────────────────────────────
export function buildStudentCard({ id, name, roll, helpRequested, editPermission, onViewCode, state, error, online = true, via, progress }) {
  const card = el('div', 'cr-student-item' + (helpRequested ? ' help' : '') + (state ? ' is-' + state : '') + (online ? '' : ' is-away'));
  card.dataset.studentId = id;

  const info = el('div', 'cr-student-info');
  info.append(textEl('span', 'cr-student-name', name), textEl('span', 'cr-student-roll', `Roll ${roll}`));

  const badges = el('div', 'cr-student-badges');
  if (helpRequested) badges.append(textEl('span', 'cr-badge cr-badge--alert', 'Needs help'));
  if (editPermission) badges.append(textEl('span', 'cr-badge cr-badge--edit', 'You can edit'));
  if (!online) badges.append(textEl('span', 'cr-badge cr-badge--away', 'Reconnecting…'));
  else if (state === 'done') badges.append(textEl('span', 'cr-badge cr-badge--done', 'Done'));
  else if (state === 'stuck' && !helpRequested) badges.append(textEl('span', 'cr-badge cr-badge--stuck', 'Stuck'));
  if (error?.type && state !== 'done') badges.append(textEl('span', 'cr-badge cr-badge--error', error.type + (error.line ? ' · L' + error.line : '')));
  if (progress) { const p = textEl('span', 'cr-badge cr-badge--progress', progress.label); p.title = progress.title; badges.append(p); }
  if (via) badges.append(textEl('span', 'cr-badge cr-badge--via', via === 'lan' ? 'Wi-Fi' : 'Internet'));

  const view = textEl('button', 'cr-view-btn cr-view-code-btn', 'View code');
  view.type = 'button';
  view.setAttribute('aria-label', `View ${name}'s code`);
  view.addEventListener('click', () => onViewCode(id, name, roll));

  card.append(info, badges, view);
  return card;
}

// ── Classroom toolbar inside the editor ───────────────────────────
export function buildEditorToolbar(role, callbacks) {
  const toolbar = el('div', 'cr-editor-toolbar');
  toolbar.id = 'cr-editor-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Classroom');

  if (role === 'teacher') {
    toolbar.innerHTML = `
      <div class="cr-toolbar-left">
        <span class="cr-toolbar-live-dot" aria-hidden="true"></span>
        <span class="cr-toolbar-label">Live class</span>
        <span class="cr-toolbar-students" id="cr-toolbar-student-count">0 students</span>
      </div>
      <div class="cr-toolbar-right">
        <button class="cr-toolbar-btn" id="cr-toolbar-view-panel" type="button">Students</button>
        <button class="cr-toolbar-btn cr-toolbar-btn--stop" id="cr-toolbar-stop" type="button">End class</button>
      </div>
    `;
    setTimeout(() => {
      document.getElementById('cr-toolbar-view-panel')?.addEventListener('click', () => callbacks.onOpenPanel?.());
      document.getElementById('cr-toolbar-stop')?.addEventListener('click', () => callbacks.onStop?.());
    }, 0);
  } else if (role === 'student') {
    toolbar.innerHTML = `
      <div class="cr-toolbar-left">
        <span class="cr-toolbar-live-dot" aria-hidden="true"></span>
        <span class="cr-toolbar-label" id="cr-toolbar-teacher-name">Connected</span>
      </div>
      <div class="cr-toolbar-right">
        <button class="cr-toolbar-btn cr-toolbar-btn--revoke hidden" id="cr-toolbar-revoke" type="button">Stop teacher editing</button>
        <button class="cr-toolbar-btn" id="cr-toolbar-raise-hand" type="button">Ask for help</button>
        <button class="cr-toolbar-btn hidden" id="cr-toolbar-gpu" data-gpu-btn type="button" title="Run this file on the GPU your teacher shares">Run on class GPU</button>
        <button class="cr-toolbar-btn" id="cr-toolbar-handin" type="button" title="Answer a short viva and hand in this file">Hand in</button>
        <button class="cr-toolbar-btn cr-done-btn" id="cr-toolbar-done" data-done-btn type="button" aria-pressed="false">I'm done</button>
        <button class="cr-toolbar-btn" id="cr-toolbar-open-panel" type="button">Class</button>
        <button class="cr-toolbar-btn cr-toolbar-btn--stop" id="cr-toolbar-disconnect" type="button">Leave</button>
      </div>
    `;
    setTimeout(() => {
      document.getElementById('cr-toolbar-revoke')?.addEventListener('click', () => callbacks.onRevoke?.());
      document.getElementById('cr-toolbar-raise-hand')?.addEventListener('click', () => callbacks.onRaiseHand?.());
      document.getElementById('cr-toolbar-done')?.addEventListener('click', () => callbacks.onDone?.());
      document.getElementById('cr-toolbar-handin')?.addEventListener('click', () => callbacks.onHandIn?.());
      document.getElementById('cr-toolbar-gpu')?.addEventListener('click', () => callbacks.onGpu?.());
      document.getElementById('cr-toolbar-open-panel')?.addEventListener('click', () => callbacks.onOpenPanel?.());
      document.getElementById('cr-toolbar-disconnect')?.addEventListener('click', () => callbacks.onDisconnect?.());
    }, 0);
  }

  return toolbar;
}

export function showRevokeButton(show) {
  document.getElementById('cr-toolbar-revoke')?.classList.toggle('hidden', !show);
}

export function updateToolbarStudentCount(count) {
  const label = document.getElementById('cr-toolbar-student-count');
  if (label) label.textContent = `${count} student${count !== 1 ? 's' : ''}`;
  const badge = document.getElementById('cr-student-count-badge');
  if (badge) badge.textContent = String(count);
}

export function updateToolbarTeacherName(name) {
  const label = document.getElementById('cr-toolbar-teacher-name');
  if (label) label.textContent = name;
}

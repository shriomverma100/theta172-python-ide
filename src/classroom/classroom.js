/**
 * THETA172 — Classroom Panel Orchestrator v2 (Overhauled)
 * 
 * Major changes:
 * - Bidirectional live code streaming (teacher ↔ student)
 * - CodeMirror 6 for live code viewers (syntax highlighting, line numbers)
 * - In-editor toolbar (no panel navigation needed)
 * - One-time edit permission with student revoke
 * - Live terminal output streaming
 */

import { showToast } from '../toast.js';
import { canApplyPushedCode, validateLiveEdit } from './edit-guard.js';
import {
  buildBaseStructure, buildRoleSelector, buildTeacherPanel,
  buildStudentPanel, buildStudentCard, blurBackground, unblurBackground,
  buildEditorToolbar, showRevokeButton, updateToolbarStudentCount,
  updateToolbarTeacherName
} from './classroom-ui.js';

// CodeMirror 6 imports for live viewers
import { EditorView, lineNumbers, highlightActiveLineGutter,
         highlightSpecialChars, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { bracketMatching } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { currentCodeTheme } from '../editor.js';
import { fx, screenTransition } from '../fx/moments.js';
import {
  initClassLive, teacherStarted, teacherStopped, noteJoin, noteLeave, noteActivity, noteHelp, liveInfo,
  studentJoined as liveStudentJoined, studentLeft as liveStudentLeft, setDone, isDone, helpError, getRelayUrl, setRelayUrl, handIn,
} from './class-live.js';
import { runOnClassGpu } from './class-share.js';

// ── State ─────────────────────────────────────────────────────────
let panelOpen = false;
let role = null; // 'teacher' | 'student' | null
let isLive = false;
let teacherName = '';
let students = []; // { id, name, roll, helpRequested, editPermission }
let $panel = null;
let studentCodeMap = {}; // studentId -> { code, fileName }
let studentOutputMap = {}; // studentId -> string
let viewingStudentId = null;
let editPermissionGranted = false; // student side: teacher has edit access
let liveViewerInstance = null; // CodeMirror instance for live code viewing
let studentViewerInstance = null; // CodeMirror instance for teacher viewing student code

// Callbacks set by main.js
let _getCode = () => '';
let _getCursor = () => ({ line: 1, col: 1 });
let _getFileName = () => 'main.py';
let _setValue = null;
let _applyEdit = null;
let _getDocLength = () => 0;
let _onLiveChange = null;
let _onContentChangeHook = null;

function createReadOnlyCM(container) {
  const view = new EditorView({
    state: EditorState.create({
      doc: '# Waiting for code...',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        python(),
        EditorState.readOnly.of(true),
        ...currentCodeTheme(),
        EditorView.theme({ '&': { fontSize: '14px' } }),
        EditorView.theme({
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    }),
    parent: container,
  });
  return view;
}

function createEditableCM(container, onChange) {
  const view = new EditorView({
    state: EditorState.create({
      doc: '# Waiting for code...',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        highlightActiveLine(),
        bracketMatching(),
        python(),
        ...currentCodeTheme(),
        EditorView.theme({ '&': { fontSize: '14px' } }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange) {
            onChange(update);
          }
        }),
      ],
    }),
    parent: container,
  });
  return view;
}

function setCMContent(view, code) {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === code) return; // No change — skip entirely

  // Compute minimal diff to avoid full-doc replacement
  // This prevents scroll jumps, cursor flicker, and the "fuzzy" feel
  let prefixLen = 0;
  const minLen = Math.min(current.length, code.length);
  while (prefixLen < minLen && current.charCodeAt(prefixLen) === code.charCodeAt(prefixLen)) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < (minLen - prefixLen) &&
    current.charCodeAt(current.length - 1 - suffixLen) === code.charCodeAt(code.length - 1 - suffixLen)
  ) {
    suffixLen++;
  }

  const from = prefixLen;
  const to = current.length - suffixLen;
  const insert = code.slice(prefixLen, code.length - suffixLen);

  if (from === to && insert.length === 0) return; // Nothing to change

  view.dispatch({
    changes: { from, to, insert },
  });
}

// ── Init ──────────────────────────────────────────────────────────
export function initClassroomPanel({ editorGetters, onLiveChange }) {
  _getCode = editorGetters.getCode;
  _getCursor = editorGetters.getCursor;
  _getFileName = editorGetters.getFileName;
  _setValue = editorGetters.setValue;
  _applyEdit = editorGetters.applyEdit || null;
  _getDocLength = editorGetters.getDocLength || (() => _getCode().length);
  _onLiveChange = onLiveChange;

  $panel = document.getElementById('classroom-panel');
  if (!$panel) return;

  buildPanel();
  setupIPCListeners();
  initClassLive({
    teacherCode: () => _getCode(),
    studentCode: (id) => studentCodeMap[id]?.code || '',
    studentsChanged: () => renderStudentList(),
    currentFile: () => ({ tabId: editorGetters.getTabId?.() ?? null, code: _getCode(), fileName: _getFileName() }),
  });
}

function buildPanel() {
  if (!$panel) return;
  $panel.innerHTML = '';

  const base = buildBaseStructure(closeClassroomPanel);
  $panel.appendChild(base);

  // Unblur background for role selector
  unblurBackground();

  const interactiveArea = document.getElementById('cr-interactive-area');
  const roleSelector = buildRoleSelector(handleRoleSelect);
  interactiveArea.appendChild(roleSelector);
}

// ── Panel Open / Close ────────────────────────────────────────────
export function openClassroomPanel() {
  if (panelOpen || !$panel) return;
  panelOpen = true;

  const focusFirstInput = () => setTimeout(() => {
    const input = $panel.querySelector('input:not([style*="display:none"])');
    if (input) input.focus();
  }, 300);

  // With pixel effects on, the panel swaps in under a pixel dissolve
  if (fx.enabled) {
    screenTransition(() => {
      $panel.classList.remove('hidden', 'closing');
      $panel.classList.add('visible', 'no-slide');
      focusFirstInput();
    });
    return;
  }

  $panel.classList.remove('hidden', 'closing', 'no-slide');
  void $panel.offsetHeight;
  requestAnimationFrame(() => {
    $panel.classList.add('visible');
    focusFirstInput();
  });
}

export function closeClassroomPanel() {
  if (!panelOpen || !$panel) return;
  panelOpen = false;

  if (fx.enabled) {
    screenTransition(() => {
      $panel.classList.remove('visible', 'closing');
      $panel.classList.add('hidden');
    });
    return;
  }

  $panel.classList.remove('visible', 'no-slide');
  $panel.classList.add('closing');

  const onEnd = () => {
    $panel.classList.remove('closing');
    $panel.classList.add('hidden');
  };
  $panel.addEventListener('transitionend', onEnd, { once: true });

  // Fallback
  setTimeout(() => {
    if (!panelOpen) onEnd();
  }, 500);
}

export function toggleClassroomPanel() {
  panelOpen ? closeClassroomPanel() : openClassroomPanel();
}

export function isClassroomPanelOpen() {
  return panelOpen;
}

export function handleClassroomKeydown(e) {
  if (e.key === 'Escape' && panelOpen) {
    closeClassroomPanel();
    return true;
  }
  return false;
}

// ── Back to Role Selector ─────────────────────────────────────────
function goBackToRoleSelector() {
  role = null;
  unblurBackground();
  buildPanel();
}

// ── In-Editor Toolbar Management ──────────────────────────────────
function injectEditorToolbar() {
  removeEditorToolbar(); // Clean up first
  const editorPane = document.getElementById('editor-pane');
  if (!editorPane) return;

  const callbacks = role === 'teacher'
    ? {
        onOpenPanel: () => openClassroomPanel(),
        onStop: () => handleStopLive(),
      }
    : {
        onRevoke: () => handleRevokeEdit(),
        onRaiseHand: () => handleRaiseHand('HELP_REQ'),
        onDone: () => setDone(!isDone()),
        onHandIn: () => handIn(),
        onGpu: () => runOnClassGpu({ code: _getCode(), fileName: _getFileName() }),
        onOpenPanel: () => openClassroomPanel(),
        onDisconnect: () => handleStudentDisconnect(),
      };

  const toolbar = buildEditorToolbar(role, callbacks);
  // Sits between the editor's header row (tabs + actions) and the code
  const header = editorPane.querySelector('.pane-header--editor');
  if (header) header.insertAdjacentElement('afterend', toolbar);
  else editorPane.prepend(toolbar);
}

function removeEditorToolbar() {
  document.getElementById('cr-editor-toolbar')?.remove();
}

function handleRevokeEdit() {
  editPermissionGranted = false;
  showRevokeButton(false);
  window.electronAPI?.classroomRevokeEdit();
  showToast('Edit permission revoked', 'info', 2000);
}

// ── Role Selection ────────────────────────────────────────────────
function handleRoleSelect(selectedRole) {
  role = selectedRole;

  const interactiveArea = document.getElementById('cr-interactive-area');
  if (!interactiveArea) return;
  interactiveArea.innerHTML = '';

  // Blur background when showing form
  blurBackground();

  // Update top-left back button to go back to role selector (not close panel)
  const globalBackBtn = document.getElementById('cr-global-back');
  if (globalBackBtn) {
    const newBtn = globalBackBtn.cloneNode(true);
    globalBackBtn.parentNode.replaceChild(newBtn, globalBackBtn);
    newBtn.addEventListener('click', () => {
      if (isLive) {
        closeClassroomPanel();
      } else {
        goBackToRoleSelector();
      }
    });
  }

  if (role === 'teacher') {
    const teacherPanel = buildTeacherPanel({
      onGoLive: handleGoLive,
      onStopLive: handleStopLive,
      onBack: goBackToRoleSelector,
      onClosePanel: closeClassroomPanel,
    });
    interactiveArea.appendChild(teacherPanel);

    const relayBox = document.getElementById('cr-relay-url');
    if (relayBox) relayBox.value = getRelayUrl();
    // Restore saved name
    const savedName = localStorage.getItem('theta-classroom-teacher-name');
    if (savedName) {
      const input = document.getElementById('cr-teacher-name');
      if (input) input.value = savedName;
    }
  } else {
    const studentPanel = buildStudentPanel({
      onJoin: handleStudentJoin,
      onRaiseHand: handleRaiseHand,
      onDisconnect: handleStudentDisconnect,
      onBack: goBackToRoleSelector,
      onClosePanel: closeClassroomPanel,
      onDone: () => setDone(!isDone()),
      onHandIn: () => handIn(),
    });
    interactiveArea.appendChild(studentPanel);
    const relayBox = document.getElementById('cr-relay-url-student');
    if (relayBox) relayBox.value = getRelayUrl();

    // Restore saved name/roll
    const savedName = localStorage.getItem('theta-classroom-student-name');
    const savedRoll = localStorage.getItem('theta-classroom-student-roll');
    if (savedName) {
      const input = document.getElementById('cr-student-name');
      if (input) input.value = savedName;
    }
    if (savedRoll) {
      const input = document.getElementById('cr-student-roll');
      if (input) input.value = savedRoll;
    }
  }

  setTimeout(() => {
    const input = interactiveArea.querySelector('input');
    if (input) input.focus();
  }, 50);
}

// ══════════════════════════════════════════════════════════════════
// TEACHER MODE
// ══════════════════════════════════════════════════════════════════

async function handleGoLive(name) {
  if (!window.electronAPI?.classroomStartServer) {
    showToast('Classroom requires Electron', 'error', 3000);
    return;
  }

  teacherName = name;
  localStorage.setItem('theta-classroom-teacher-name', name);

  const relayInput = document.getElementById('cr-relay-url');
  if (relayInput) setRelayUrl(relayInput.value);
  const result = await window.electronAPI.classroomStartServer(name, { relayUrl: getRelayUrl() });
  if (!result.success) {
    showToast(`Failed to go live: ${result.error}`, 'error', 3000);
    return;
  }

  isLive = true;
  if (_onLiveChange) _onLiveChange(true);

  // Switch UI
  const setup = document.getElementById('cr-teacher-setup');
  const liveView = document.getElementById('cr-live-view');
  const liveName = document.getElementById('cr-live-teacher-name');
  const status = document.getElementById('cr-status');

  if (setup) setup.classList.add('hidden');
  if (liveView) liveView.classList.remove('hidden');
  if (liveName) liveName.textContent = name;
  if (status) status.textContent = result.lan ? `Live on ${result.ip}` : 'Live over the internet';
  teacherStarted(result);
  document.getElementById('cr-join-code-copy')?.addEventListener('click', () => {
    const code = document.querySelector('#cr-join-code .cr-join-code__value')?.textContent || '';
    if (code) navigator.clipboard.writeText(code).then(() => showToast(`Copied the code ${code}`, 'success', 1600)).catch(() => {});
  });

  // Inject in-editor toolbar
  injectEditorToolbar();

  // Send initial code sync
  broadcastCurrentCode();

  showToast(result.lan ? `Live on ${result.ip}:${result.port}` : 'Live: students join with the class code', 'success', 3000);

  // Setup student search
  const searchInput = document.getElementById('cr-student-search');
  searchInput?.addEventListener('input', (e) => {
    filterStudentList(e.target.value);
  });

  // Setup Chat
  const sendBtn = document.getElementById('cr-teacher-chat-send');
  const inputField = document.getElementById('cr-teacher-chat-input');
  const targetSelect = document.getElementById('cr-teacher-chat-target');
  
  const sendChat = () => {
    const text = inputField?.value.trim();
    if (!text) return;
    const target = targetSelect?.value || 'broadcast';
    window.electronAPI?.classroomSendChatMessage(text, target, teacherName);
    appendChatMessage('ME', text, true);
    if (inputField) inputField.value = '';
  };

  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  if (inputField) inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
}

async function handleStopLive() {
  if (!window.electronAPI?.classroomStopServer) return;

  await window.electronAPI.classroomStopServer();
  teacherStopped();
  isLive = false;
  students = [];
  if (_onLiveChange) _onLiveChange(false);

  // Remove toolbar
  removeEditorToolbar();

  // Destroy student viewer
  if (studentViewerInstance) {
    studentViewerInstance.destroy();
    studentViewerInstance = null;
  }

  // Reset UI
  const setup = document.getElementById('cr-teacher-setup');
  const liveView = document.getElementById('cr-live-view');
  const codeViewer = document.getElementById('cr-student-code-viewer');
  const status = document.getElementById('cr-status');

  if (setup) setup.classList.remove('hidden');
  if (liveView) liveView.classList.add('hidden');
  if (codeViewer) codeViewer.classList.add('hidden');
  if (status) status.textContent = 'Not connected';

  showToast('Classroom session ended', 'info', 2000);
}

let _teacherBroadcastDebounce = null;
export function broadcastCurrentCode() {
  if (!isLive || !window.electronAPI?.classroomBroadcastCode) return;

  // Debounce teacher broadcast to prevent flooding the WebSocket
  // and causing the "fuzzy typing" feel on both ends
  clearTimeout(_teacherBroadcastDebounce);
  _teacherBroadcastDebounce = setTimeout(() => {
    const code = _getCode();
    const cursor = _getCursor();
    const fileName = _getFileName();
    window.electronAPI.classroomBroadcastCode(code, cursor, fileName);
  }, 80);
}

export function isTeacherLive() {
  return isLive && role === 'teacher';
}

export function isStudentConnected() {
  return isLive && role === 'student';
}

// ── Student Live Code Streaming (student -> teacher) ──────────────
let _studentCodeDebounce = null;
export function streamStudentCode() {
  if (!isLive || role !== 'student') return;
  if (!window.electronAPI?.classroomSendCodeLive) return;

  clearTimeout(_studentCodeDebounce);
  _studentCodeDebounce = setTimeout(() => {
    const code = _getCode();
    const fileName = _getFileName();
    window.electronAPI.classroomSendCodeLive(code, fileName);
  }, 100); // Reduced from 300ms -> 100ms for near-realtime student code streaming
}

export function streamStudentOutput(text, stream) {
  if (!isLive || role !== 'student') return;
  if (!window.electronAPI?.classroomSendOutputLive) return;
  window.electronAPI.classroomSendOutputLive(text, stream);
}

function renderStudentList() {
  const list = document.getElementById('cr-students-list');
  if (!list) return;

  updateToolbarStudentCount(students.length);

  if (students.length === 0) {
    list.innerHTML = `<div class="cr-waiting-text">Waiting for students to join…</div>`;
    updateChatTargetSelect();
    return;
  }

  list.innerHTML = '';
  students.forEach((s) => {
    const card = buildStudentCard({
      ...s,
      ...liveInfo(s.id),
      onViewCode: (id, name, roll) => handleViewStudentCode(id, name, roll),
    });
    list.appendChild(card);
  });
  updateChatTargetSelect();
}

function updateChatTargetSelect() {
  if (role !== 'teacher') return;
  const select = document.getElementById('cr-teacher-chat-target');
  if (!select) return;
  
  const currentVal = select.value;
  select.innerHTML = '<option value="broadcast">ALL STUDENTS</option>';
  students.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.roll})`;
    select.appendChild(opt);
  });
  if (students.find(s => s.id === currentVal) || currentVal === 'broadcast') {
    select.value = currentVal;
  }
}

function filterStudentList(query) {
  const q = query.toLowerCase();
  const cards = document.querySelectorAll('.cr-student-item');
  cards.forEach((card) => {
    const name = card.querySelector('.cr-student-name')?.textContent?.toLowerCase() || '';
    const roll = card.querySelector('.cr-student-roll')?.textContent?.toLowerCase() || '';
    card.style.display = (name.includes(q) || roll.includes(q)) ? '' : 'none';
  });
}

function handleViewStudentCode(studentId, name, roll) {
  viewingStudentId = studentId;

  // Request student's latest code
  window.electronAPI?.classroomRequestStudentCode(studentId);

  // Show code viewer
  const liveView = document.getElementById('cr-live-view');
  const codeViewer = document.getElementById('cr-student-code-viewer');
  const viewerName = document.getElementById('cr-code-viewer-name');
  const pushBtn = document.getElementById('cr-push-edit-btn');
  const editStatus = document.getElementById('cr-edit-status');

  if (liveView) liveView.classList.add('hidden');
  if (codeViewer) codeViewer.classList.remove('hidden');
  if (viewerName) viewerName.textContent = `${name} (${roll})`;
  if (pushBtn) pushBtn.classList.add('hidden');

  // Check existing edit permission
  const student = students.find(s => s.id === studentId);
  if (student?.editPermission) {
    if (editStatus) editStatus.textContent = 'You can edit';
    if (editStatus) editStatus.className = 'cr-edit-status cr-edit-status--granted';
    if (pushBtn) pushBtn.classList.remove('hidden');
  } else {
    if (editStatus) editStatus.textContent = '';
    if (editStatus) editStatus.className = 'cr-edit-status';
  }

  // Create CodeMirror instance for student code
  const editorContainer = document.getElementById('cr-student-live-editor');
  if (editorContainer) {
    editorContainer.innerHTML = '';
    if (studentViewerInstance) {
      studentViewerInstance.destroy();
      studentViewerInstance = null;
    }

    // Check if we have edit permission — make editable or read-only
    if (student?.editPermission) {
      studentViewerInstance = createEditableCM(editorContainer, (update) => {
        // Only send live edits if triggered by user action to avoid infinite loops
        const isUserAction = update.transactions.some(tr => 
          tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo')
        );
        if (isUserAction && viewingStudentId && window.electronAPI?.classroomSendLiveEdit) {
          update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            window.electronAPI.classroomSendLiveEdit(viewingStudentId, fromA, toA, inserted.toString());
          });
        }
      });
    } else {
      studentViewerInstance = createReadOnlyCM(editorContainer);
    }
  }

  // Show cached code if available
  const cached = studentCodeMap[studentId];
  if (cached?.code && studentViewerInstance) {
    setCMContent(studentViewerInstance, cached.code);
  }

  // Show cached output
  const termOut = document.getElementById('cr-student-terminal-output');
  if (termOut) {
    termOut.textContent = studentOutputMap[studentId] || '';
  }

  // Wire back button
  const backBtn = document.getElementById('cr-code-viewer-back');
  if (backBtn) {
    const newBtn = backBtn.cloneNode(true);
    backBtn.parentNode.replaceChild(newBtn, backBtn);
    newBtn.addEventListener('click', () => {
      viewingStudentId = null;
      if (studentViewerInstance) {
        studentViewerInstance.destroy();
        studentViewerInstance = null;
      }
      if (codeViewer) codeViewer.classList.add('hidden');
      if (liveView) liveView.classList.remove('hidden');
    });
  }

  // Wire edit request button
  const reqBtn = document.getElementById('cr-request-edit-btn');
  if (reqBtn) {
    const newBtn = reqBtn.cloneNode(true);
    reqBtn.parentNode.replaceChild(newBtn, reqBtn);
    newBtn.addEventListener('click', () => {
      window.electronAPI?.classroomRequestEdit(studentId);
      showToast('Edit permission requested...', 'info', 2000);
    });
  }

  // Wire push edits button
  const pushBtnEl = document.getElementById('cr-push-edit-btn');
  if (pushBtnEl) {
    const newBtn = pushBtnEl.cloneNode(true);
    // Keep hidden/visible state
    if (student?.editPermission) newBtn.classList.remove('hidden');
    else newBtn.classList.add('hidden');
    pushBtnEl.parentNode.replaceChild(newBtn, pushBtnEl);
    newBtn.addEventListener('click', () => {
      const code = studentViewerInstance?.state.doc.toString();
      if (code && viewingStudentId) {
        window.electronAPI?.classroomSendEdit(viewingStudentId, code);
        showToast('Code pushed to student', 'success', 2000);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// STUDENT MODE
// ══════════════════════════════════════════════════════════════════

function handleStudentJoin(name, roll, code = '') {
  if (!window.electronAPI?.classroomStartDiscovery) {
    showToast('Classroom requires Electron', 'error', 3000);
    return;
  }

  localStorage.setItem('theta-classroom-student-name', name);
  localStorage.setItem('theta-classroom-student-roll', roll);

  // Show discovery state
  const setup = document.getElementById('cr-student-setup');
  const discovery = document.getElementById('cr-discovery');
  if (setup) setup.classList.add('hidden');
  if (discovery) discovery.classList.remove('hidden');

  const relayBox = document.getElementById('cr-relay-url-student');
  if (relayBox) setRelayUrl(relayBox.value);
  const discoveryText = document.getElementById('cr-discovery-text');
  if (discoveryText) {
    discoveryText.textContent = code
      ? 'Joining with the class code (and looking on this network)…'
      : "Looking for a class on this network… Not on your teacher's Wi-Fi? Go back and type the class code.";
  }
  window.electronAPI.classroomStartDiscovery(name, roll, { code, relayUrl: getRelayUrl() });

  // Setup Chat
  const sendBtn = document.getElementById('cr-student-chat-send');
  const inputField = document.getElementById('cr-student-chat-input');
  const targetSelect = document.getElementById('cr-student-chat-target');
  
  const sendChat = () => {
    const text = inputField?.value.trim();
    if (!text) return;
    const target = targetSelect?.value || 'teacher';
    window.electronAPI?.classroomSendChatMessage(text, target, name);
    appendChatMessage('ME', text, true);
    if (inputField) inputField.value = '';
  };

  if (sendBtn) sendBtn.addEventListener('click', sendChat);
  if (inputField) inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });
}

let _raiseHandCooldown = false;
function handleRaiseHand(message) {
  if (!window.electronAPI?.classroomSendHelp) return;

  // Prevent spamming — enforce a 10-second cooldown
  if (_raiseHandCooldown) {
    showToast('Please wait before raising hand again', 'info', 2000);
    return;
  }

  _raiseHandCooldown = true;
  window.electronAPI.classroomSendHelp(message, helpError());
  showToast('Help request sent to teacher', 'success', 2000);

  // Visual feedback — disable button during cooldown
  const btn = document.getElementById('cr-raise-hand-btn');
  const toolbarBtn = document.getElementById('cr-toolbar-raise-hand');
  if (btn) {
    btn.classList.add('cr-hand-cooldown');
    const label = btn.querySelector('.cr-hand-label');
    if (label) label.textContent = 'Help requested';
  }
  if (toolbarBtn) {
    toolbarBtn.classList.add('cr-hand-cooldown');
    toolbarBtn.style.opacity = '0.5';
    toolbarBtn.style.pointerEvents = 'none';
  }

  setTimeout(() => {
    _raiseHandCooldown = false;
    if (btn) {
      btn.classList.remove('cr-hand-cooldown');
      const label = btn.querySelector('.cr-hand-label');
      if (label) label.textContent = 'Ask for help';
    }
    if (toolbarBtn) {
      toolbarBtn.classList.remove('cr-hand-cooldown');
      toolbarBtn.style.opacity = '';
      toolbarBtn.style.pointerEvents = '';
    }
  }, 10000);
}

function handleStudentDisconnect() {
  if (!window.electronAPI?.classroomStopDiscovery) return;
  window.electronAPI.classroomStopDiscovery();
  liveStudentLeft();

  isLive = false;
  editPermissionGranted = false;

  // Remove toolbar
  removeEditorToolbar();

  // Destroy live viewer
  if (liveViewerInstance) {
    liveViewerInstance.destroy();
    liveViewerInstance = null;
  }

  // Reset UI
  const setup = document.getElementById('cr-student-setup');
  const connected = document.getElementById('cr-connected-view');
  const discovery = document.getElementById('cr-discovery');
  const status = document.getElementById('cr-status');

  if (setup) setup.classList.remove('hidden');
  if (connected) connected.classList.add('hidden');
  if (discovery) discovery.classList.add('hidden');
  if (status) status.textContent = 'Not connected';

  showToast('Disconnected from classroom', 'info', 2000);
}

// ── IPC Event Listeners ───────────────────────────────────────────
function appendChatMessage(sender, text, isSelf) {
  const container = role === 'teacher' 
    ? document.getElementById('cr-teacher-chat-messages')
    : document.getElementById('cr-student-chat-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = 'cr-chat-message' + (isSelf ? ' self' : '');
  
  const meta = document.createElement('div');
  meta.className = 'cr-chat-meta';
  meta.textContent = sender;
  
  const content = document.createElement('div');
  content.className = 'cr-chat-text';
  content.textContent = text;
  
  msgDiv.appendChild(meta);
  msgDiv.appendChild(content);
  
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function setupIPCListeners() {
  const api = window.electronAPI;
  if (!api) return;

  // ── Teacher events ──
  if (api.onStudentJoined) {
    api.onStudentJoined((info) => {
      students.push({ id: info.id, name: info.name, roll: info.roll, helpRequested: false, editPermission: false, via: info.via });
      noteJoin(info);
      renderStudentList();
      showToast(`${info.name} joined`, 'success', 2000);
    });
  }

  if (api.onStudentLeft) {
    api.onStudentLeft((info) => {
      students = students.filter((s) => s.id !== info.id);
      noteLeave(info.id);
      delete studentCodeMap[info.id];
      delete studentOutputMap[info.id];
      renderStudentList();
      showToast(`${info.name} left`, 'info', 2000);
    });
  }

  if (api.onHelpRequest) {
    api.onHelpRequest((info) => {
      const s = students.find((s) => s.id === info.id);
      if (s) s.helpRequested = true;
      noteHelp(info);
      renderStudentList();
      showToast(`${info.name} needs help!`, 'error', 4000);
    });
  }

  if (api.onStudentCode) {
    api.onStudentCode((info) => {
      studentCodeMap[info.id] = { code: info.code, fileName: info.fileName };
      // Update viewer if viewing this student
      if (viewingStudentId === info.id && studentViewerInstance) {
        setCMContent(studentViewerInstance, info.code);
      }
    });
  }

  // Live code streaming from students
  if (api.onStudentCodeLive) {
    api.onStudentCodeLive((info) => {
      studentCodeMap[info.id] = { code: info.code, fileName: info.fileName };
      noteActivity(info.id);
      // Update viewer if viewing this student
      if (viewingStudentId === info.id && studentViewerInstance) {
        setCMContent(studentViewerInstance, info.code);
      }
      // Update filename
      if (viewingStudentId === info.id) {
        const fn = document.getElementById('cr-viewer-filename');
        if (fn) fn.textContent = info.fileName || 'main.py';
      }
    });
  }

  // Live output streaming from students
  if (api.onStudentOutputLive) {
    api.onStudentOutputLive((info) => {
      if (!studentOutputMap[info.id]) studentOutputMap[info.id] = '';
      const plainText = info.text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
      studentOutputMap[info.id] += plainText;
      // Update terminal if viewing this student
      if (viewingStudentId === info.id) {
        const termOut = document.getElementById('cr-student-terminal-output');
        if (termOut) {
          termOut.textContent = studentOutputMap[info.id];
          termOut.scrollTop = termOut.scrollHeight;
        }
      }
    });
  }

  if (api.onEditGrant) {
    api.onEditGrant((info) => {
      const student = students.find(s => s.id === info.id);
      if (info.granted) {
        if (student) student.editPermission = true;
        showToast(`${info.name} granted edit permission`, 'success', 3000);

        // If viewing this student, recreate editor as editable
        if (viewingStudentId === info.id) {
          const editStatus = document.getElementById('cr-edit-status');
          if (editStatus) {
            editStatus.textContent = 'You can edit';
            editStatus.className = 'cr-edit-status cr-edit-status--granted';
          }
          const pushBtn = document.getElementById('cr-push-edit-btn');
          if (pushBtn) pushBtn.classList.remove('hidden');

          // Recreate as editable
          const editorContainer = document.getElementById('cr-student-live-editor');
          if (editorContainer) {
            const currentCode = studentViewerInstance?.state.doc.toString() || '';
            if (studentViewerInstance) {
              studentViewerInstance.destroy();
              studentViewerInstance = null;
            }
            editorContainer.innerHTML = '';
            studentViewerInstance = createEditableCM(editorContainer, (update) => {
              if (viewingStudentId && window.electronAPI?.classroomSendLiveEdit) {
                update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                  window.electronAPI.classroomSendLiveEdit(viewingStudentId, fromA, toA, inserted.toString());
                });
              }
            });
            setCMContent(studentViewerInstance, currentCode);
          }
        }

        renderStudentList();
      } else {
        showToast(`${info.name} denied edit permission`, 'info', 3000);
      }
    });
  }

  // Edit revoke (from student)
  if (api.onEditRevoke) {
    api.onEditRevoke((info) => {
      const student = students.find(s => s.id === info.id);
      if (student) student.editPermission = false;
      showToast(`${info.name} revoked edit permission`, 'info', 3000);

      // If viewing this student, switch to read-only
      if (viewingStudentId === info.id) {
        const editStatus = document.getElementById('cr-edit-status');
        if (editStatus) {
          editStatus.textContent = 'Editing turned off';
          editStatus.className = 'cr-edit-status cr-edit-status--revoked';
        }
        const pushBtn = document.getElementById('cr-push-edit-btn');
        if (pushBtn) pushBtn.classList.add('hidden');

        // Recreate as read-only
        const editorContainer = document.getElementById('cr-student-live-editor');
        if (editorContainer) {
          const currentCode = studentViewerInstance?.state.doc.toString() || '';
          if (studentViewerInstance) {
            studentViewerInstance.destroy();
            studentViewerInstance = null;
          }
          editorContainer.innerHTML = '';
          studentViewerInstance = createReadOnlyCM(editorContainer);
          setCMContent(studentViewerInstance, currentCode);
        }
      }

      renderStudentList();
    });
  }

  // ── Student events ──
  if (api.onTeacherFound) {
    api.onTeacherFound((info) => {
      const txt = document.getElementById('cr-discovery-text');
      if (txt) txt.textContent = `Found ${info.teacher}. Connecting…`;
    });
  }

  if (api.onClassroomConnected) {
    api.onClassroomConnected((info) => {
      isLive = true;

      const discovery = document.getElementById('cr-discovery');
      const connected = document.getElementById('cr-connected-view');
      const teacherEl = document.getElementById('cr-connected-teacher');
      const status = document.getElementById('cr-status');

      if (discovery) discovery.classList.add('hidden');
      if (connected) connected.classList.remove('hidden');
      if (teacherEl) teacherEl.textContent = info.teacher;
      if (status) status.textContent = `Watching ${info.teacher}`;

      // Create CodeMirror live viewer for teacher code
      const editorContainer = document.getElementById('cr-teacher-live-editor');
      if (editorContainer) {
        editorContainer.innerHTML = '';
        if (liveViewerInstance) {
          liveViewerInstance.destroy();
        }
        liveViewerInstance = createReadOnlyCM(editorContainer);
      }

      // Inject in-editor toolbar
      injectEditorToolbar();
      updateToolbarTeacherName(info.teacher);

      liveStudentJoined();
      showToast(`Connected to ${info.teacher}${info.via === 'lan' ? '' : ' over the internet'}`, 'success', 2000);
    });
  }

  if (api.onClassroomDisconnected) {
    api.onClassroomDisconnected(() => {
      showToast('Disconnected from teacher', 'error', 3000);
      handleStudentDisconnect();
    });
  }

  if (api.onClassroomCodeSync) {
    api.onClassroomCodeSync((data) => {
      // Update CodeMirror live viewer
      if (liveViewerInstance) {
        setCMContent(liveViewerInstance, data.code);
      }
      const fn = document.getElementById('cr-teacher-filename');
      if (fn && data.fileName) fn.textContent = data.fileName;
    });
  }

  if (api.onClassroomCodeChange) {
    api.onClassroomCodeChange((_data) => {
      // Incremental changes could be handled here for even smoother sync
    });
  }

  if (api.onClassroomTerminal) {
    api.onClassroomTerminal((data) => {
      const termOut = document.getElementById('cr-terminal-output');
      if (termOut && data.text) {
        const plainText = data.text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
        termOut.textContent += plainText;
        termOut.scrollTop = termOut.scrollHeight;
      }
    });
  }

  if (api.onClassroomCursor) {
    api.onClassroomCursor((data) => {
      const indicator = document.getElementById('cr-cursor-indicator');
      if (indicator && data.line !== undefined) {
        indicator.textContent = `Ln ${data.line} · Col ${data.col}`;
      }
    });
  }

  if (api.onClassroomViewRequest) {
    api.onClassroomViewRequest(() => {
      // Teacher wants to see our code — send it
      const code = _getCode();
      const fileName = _getFileName();
      api.classroomSendCode(code, fileName);
    });
  }

  if (api.onClassroomEditRequest) {
    api.onClassroomEditRequest(() => {
      // If already granted, auto-approve
      if (editPermissionGranted) {
        api.classroomGrantEdit(true);
        showToast('Edit permission auto-granted', 'info', 2000);
        return;
      }

      // Show permission dialog overlay
      const overlay = document.getElementById('cr-edit-dialog-overlay');
      if (overlay) overlay.classList.remove('hidden');

      const grantBtn = document.getElementById('cr-grant-edit');
      const denyBtn = document.getElementById('cr-deny-edit');

      if (grantBtn) {
        const newBtn = grantBtn.cloneNode(true);
        grantBtn.parentNode.replaceChild(newBtn, grantBtn);
        newBtn.addEventListener('click', () => {
          editPermissionGranted = true;
          api.classroomGrantEdit(true);
          if (overlay) overlay.classList.add('hidden');
          showRevokeButton(true);
          showToast('Edit permission granted — revoke anytime from toolbar', 'info', 3000);
        }, { once: true });
      }

      if (denyBtn) {
        const newBtn = denyBtn.cloneNode(true);
        denyBtn.parentNode.replaceChild(newBtn, denyBtn);
        newBtn.addEventListener('click', () => {
          api.classroomGrantEdit(false);
          if (overlay) overlay.classList.add('hidden');
          showToast('Edit permission denied', 'info', 2000);
        }, { once: true });
      }
    });
  }

  if (api.onClassroomEditCode) {
    api.onClassroomEditCode((data) => {
      // Teacher pushed full code. Only allowed after the student granted
      // edit access: the network message alone is not proof of consent.
      if (!_setValue || !canApplyPushedCode(editPermissionGranted, data)) return;
      _setValue(data.code);
      showToast('Teacher updated your code', 'info', 2000);
    });
  }

  // Live incremental edits from teacher
  if (api.onClassroomEditLive) {
    api.onClassroomEditLive((data) => {
      if (!_applyEdit) return;
      const change = validateLiveEdit(editPermissionGranted, data, _getDocLength());
      if (change) _applyEdit(change.from, change.to, change.insert);
    });
  }

  if (api.onClassroomSessionEnd) {
    api.onClassroomSessionEnd(() => {
      showToast('Teacher ended the session', 'info', 3000);
      handleStudentDisconnect();
    });
  }

  // ── Global Chat Message Event ──
  if (api.onClassroomChatMessageReceived) {
    api.onClassroomChatMessageReceived((info) => {
      const sender = info.name || (role === 'student' ? 'TEACHER' : 'UNKNOWN');
      appendChatMessage(sender, info.text, false);
    });
  }
}

/**
 * THETA172 — Collab Editor Manager
 * Manages collaborative editing sessions using Yjs CRDT.
 *
 * Teacher side:
 *   - Toggle collab mode ON/OFF
 *   - Bind Yjs to existing CodeMirror editor
 *   - Pause/resume StateCapture
 *
 * Student side:
 *   - On COLLAB_MODE ON: create real CM6 editor, bind to shared Y.Doc
 *   - On COLLAB_MODE OFF: destroy editor, restore read-only overlay
 *   - Show remote cursors via awareness
 */

import '../styles/collab-editor.css';

import * as Y from 'yjs';
import { yCollab } from 'y-codemirror.next';
import { CollabYjsProvider, CURSOR_COLORS } from './collab-yjs-provider.js';

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter,
         highlightSpecialChars, drawSelection, dropCursor,
         highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentOnInput, bracketMatching,
         foldGutter, foldKeymap } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Max students that can edit simultaneously */
const MAX_COLLAB_EDITORS = 20;


// ══════════════════════════════════════════════════════════════════
// SVG ICONS
// ══════════════════════════════════════════════════════════════════

const COLLAB_ICON = {
  edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,

  users: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,

  lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,

  unlock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>`,

  close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};


// ══════════════════════════════════════════════════════════════════
// COLLAB EDITOR MANAGER
// ══════════════════════════════════════════════════════════════════

export class CollabEditor {
  constructor() {
    /** @type {CollabYjsProvider | null} */
    this._provider = null;

    /** @type {boolean} */
    this._collabActive = false;

    /** @type {boolean} */
    this._isTeacher = false;

    /** @type {EditorView | null} - Student-side CM6 editor */
    this._studentEditor = null;

    /** @type {HTMLElement | null} - Student editor container */
    this._studentContainer = null;

    /** @type {Function | null} - Callback to pause state capture */
    this.onPauseCapture = null;

    /** @type {Function | null} - Callback to resume state capture */
    this.onResumeCapture = null;

    /** @type {Function | null} - Callback to get current code */
    this.onGetCode = null;

    /** @type {Function | null} - Callback to set code in teacher editor */
    this.onSetCode = null;

    /** @type {Function | null} - Callback to get teacher EditorView */
    this.onGetEditorView = null;

    /** @type {Function | null} - Callback to hide state renderer (student) */
    this.onHideRenderer = null;

    /** @type {Function | null} - Callback to show state renderer (student) */
    this.onShowRenderer = null;

    /** @type {Function | null} - Callback to send collab mode change */
    this.onSendCollabMode = null;

    /** @type {Function | null} - Callback to send CRDT data */
    this.onSendCrdt = null;

    /** @type {Function | null} - Callback to send awareness data */
    this.onSendAwareness = null;

    /** @type {Function | null} - Disconnect callback for student */
    this.onDisconnect = null;

    /** @type {string} */
    this._userName = '';

    /** @type {Array} - Active yCollab extensions */
    this._collabExtensions = [];
  }


  // ── TEACHER: TOGGLE COLLAB MODE ──────────────────────────────

  /**
   * Initialize as teacher.
   * @param {Object} options
   * @param {string} options.userName
   * @param {Function} options.onSendCrdt
   * @param {Function} options.onSendAwareness
   * @param {Function} options.onSendCollabMode
   * @param {Function} options.onGetCode
   * @param {Function} options.onSetCode
   * @param {Function} options.onGetEditorView
   * @param {Function} options.onPauseCapture
   * @param {Function} options.onResumeCapture
   */
  initTeacher(options) {
    this._isTeacher = true;
    this._userName = options.userName || 'Teacher';
    this.onSendCrdt = options.onSendCrdt;
    this.onSendAwareness = options.onSendAwareness;
    this.onSendCollabMode = options.onSendCollabMode;
    this.onGetCode = options.onGetCode;
    this.onSetCode = options.onSetCode;
    this.onGetEditorView = options.onGetEditorView;
    this.onPauseCapture = options.onPauseCapture;
    this.onResumeCapture = options.onResumeCapture;
  }

  /**
   * Toggle collaborative editing mode (teacher only).
   */
  toggleCollabMode() {
    if (!this._isTeacher) return;

    if (this._collabActive) {
      this._stopCollabTeacher();
    } else {
      this._startCollabTeacher();
    }
  }

  /**
   * Start collaborative editing (teacher side).
   */
  _startCollabTeacher() {
    if (this._collabActive) return;

    const currentCode = this.onGetCode ? this.onGetCode() : '';
    const editorView = this.onGetEditorView ? this.onGetEditorView() : null;

    if (!editorView) {
      console.error('[COLLAB-EDITOR] No editor view available');
      return;
    }

    // Create Yjs provider with current code
    this._provider = new CollabYjsProvider({
      userName: this._userName,
      isTeacher: true,
      initialCode: currentCode,
      clientId: 0, // Teacher gets color index 0
      sendSync: (data) => {
        if (this.onSendCrdt) this.onSendCrdt(data);
      },
      sendAwareness: (data) => {
        if (this.onSendAwareness) this.onSendAwareness(data);
      },
    });

    // Bind Yjs to the teacher's CodeMirror editor
    const undoManager = new Y.UndoManager(this._provider.ytext);

    this._collabExtensions = yCollab(
      this._provider.ytext,
      this._provider.awareness,
      { undoManager }
    );

    // Add collab extensions to the editor
    editorView.dispatch({
      effects: EditorView.reconfigure.appendConfig.of(this._collabExtensions),
    });

    // Pause one-way state capture (Yjs handles code sync now)
    if (this.onPauseCapture) this.onPauseCapture();

    // Broadcast full state to any already-connected viewers
    this._provider.broadcastFullState();

    // Notify all viewers that collab mode is ON
    if (this.onSendCollabMode) {
      this.onSendCollabMode({ enabled: true });
    }

    this._collabActive = true;
    this._updateModeIndicator(true);

    console.log('[COLLAB-EDITOR] Teacher started collab mode');
  }

  /**
   * Stop collaborative editing (teacher side).
   */
  _stopCollabTeacher() {
    if (!this._collabActive) return;

    // Get final code from CRDT before destroying
    const finalCode = this._provider ? this._provider.getCode() : '';

    // Destroy provider
    if (this._provider) {
      this._provider.destroy();
      this._provider = null;
    }

    // Remove collab extensions from editor
    // (The extensions were added dynamically; we need to reconfigure)
    const editorView = this.onGetEditorView ? this.onGetEditorView() : null;
    if (editorView) {
      // Force a reconfigure without collab extensions
      // The simplest approach: set the code from the final CRDT state
      if (this.onSetCode && finalCode) {
        this.onSetCode(finalCode);
      }
    }

    // Resume one-way state capture
    if (this.onResumeCapture) this.onResumeCapture();

    // Notify viewers that collab mode is OFF
    if (this.onSendCollabMode) {
      this.onSendCollabMode({ enabled: false });
    }

    this._collabActive = false;
    this._collabExtensions = [];
    this._updateModeIndicator(false);

    console.log('[COLLAB-EDITOR] Teacher stopped collab mode');
  }


  // ── STUDENT: HANDLE COLLAB MODE CHANGE ───────────────────────

  /**
   * Initialize as student.
   * @param {Object} options
   * @param {string} options.userName
   * @param {number} options.clientId
   * @param {Function} options.onSendCrdt
   * @param {Function} options.onSendAwareness
   * @param {Function} options.onHideRenderer
   * @param {Function} options.onShowRenderer
   * @param {Function} options.onDisconnect
   */
  initStudent(options) {
    this._isTeacher = false;
    this._userName = options.userName || 'Student';
    this._clientId = options.clientId || Math.floor(Math.random() * 1000);
    this.onSendCrdt = options.onSendCrdt;
    this.onSendAwareness = options.onSendAwareness;
    this.onHideRenderer = options.onHideRenderer;
    this.onShowRenderer = options.onShowRenderer;
    this.onDisconnect = options.onDisconnect;
  }

  /**
   * Handle collab mode change from teacher.
   * @param {Object} data - { enabled: boolean }
   */
  handleCollabModeChange(data) {
    if (this._isTeacher) return;

    if (data.enabled) {
      this._startCollabStudent();
    } else {
      this._stopCollabStudent();
    }
  }

  /**
   * Start collaborative editing (student side).
   */
  _startCollabStudent() {
    if (this._collabActive) return;

    // Hide the read-only state renderer overlay
    if (this.onHideRenderer) this.onHideRenderer();

    // Create Yjs provider (student — no initial code, will sync from teacher)
    this._provider = new CollabYjsProvider({
      userName: this._userName,
      isTeacher: false,
      clientId: this._clientId || 1,
      sendSync: (data) => {
        if (this.onSendCrdt) this.onSendCrdt(data);
      },
      sendAwareness: (data) => {
        if (this.onSendAwareness) this.onSendAwareness(data);
      },
    });

    // Build student editor UI
    this._buildStudentEditor();

    // Request sync from teacher (sync step 1)
    this._provider.requestSync();

    this._collabActive = true;

    console.log('[COLLAB-EDITOR] Student started collab mode');
  }

  /**
   * Stop collaborative editing (student side).
   */
  _stopCollabStudent() {
    if (!this._collabActive) return;

    // Destroy student editor
    this._destroyStudentEditor();

    // Destroy provider
    if (this._provider) {
      this._provider.destroy();
      this._provider = null;
    }

    // Re-show the read-only state renderer overlay
    if (this.onShowRenderer) this.onShowRenderer();

    this._collabActive = false;

    console.log('[COLLAB-EDITOR] Student stopped collab mode');
  }


  // ── RECEIVE CRDT MESSAGES ────────────────────────────────────

  /**
   * Handle incoming CRDT sync data.
   * @param {Object} data - { encoded: string }
   */
  handleCrdtSync(data) {
    if (this._provider) {
      this._provider.handleSyncMessage(data);
    }
  }

  /**
   * Handle incoming awareness data.
   * @param {Object} data - { encoded: string }
   */
  handleAwareness(data) {
    if (this._provider) {
      this._provider.handleAwarenessMessage(data);
    }
  }


  // ── STUDENT EDITOR ───────────────────────────────────────────

  /**
   * Build the student's CodeMirror 6 editor.
   */
  _buildStudentEditor() {
    if (this._studentContainer) return;

    // Create container
    this._studentContainer = document.createElement('div');
    this._studentContainer.className = 'collab-editor-container';
    this._studentContainer.id = 'collab-editor-container';

    // Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'collab-editor__status-bar';

    const modeLabel = document.createElement('div');
    modeLabel.className = 'collab-editor__mode-label';
    modeLabel.innerHTML = `${COLLAB_ICON.edit} <span>COLLABORATIVE EDITING</span>`;

    const usersLabel = document.createElement('div');
    usersLabel.className = 'collab-editor__users-label';
    usersLabel.id = 'collab-editor-users';
    usersLabel.innerHTML = `${COLLAB_ICON.users} <span>Syncing...</span>`;

    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'collab-editor__disconnect-btn';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.addEventListener('click', () => {
      if (this.onDisconnect) this.onDisconnect();
    });

    statusBar.appendChild(modeLabel);
    statusBar.appendChild(usersLabel);
    statusBar.appendChild(disconnectBtn);

    // Editor wrapper
    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'collab-editor__editor-wrapper';
    editorWrapper.id = 'collab-editor-wrapper';

    this._studentContainer.appendChild(statusBar);
    this._studentContainer.appendChild(editorWrapper);
    document.body.appendChild(this._studentContainer);

    // Animate in
    requestAnimationFrame(() => {
      this._studentContainer.classList.add('visible');
    });

    // Create CodeMirror 6 editor with Yjs binding
    const undoManager = new Y.UndoManager(this._provider.ytext);

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),

      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),

      python(),

      // Dark theme for student editor
      EditorView.theme({
        '&': {
          backgroundColor: '#111111',
          color: '#E8E8E6',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: '15px',
          height: '100%',
        },
        '.cm-content': {
          caretColor: '#00D4FF',
          lineHeight: '25px',
          padding: '20px 0 60px 0',
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: '#00D4FF',
          borderLeftWidth: '2px',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
          backgroundColor: '#00D4FF33 !important',
        },
        '.cm-activeLine': {
          backgroundColor: '#1A1A18',
        },
        '.cm-activeLineGutter': {
          backgroundColor: '#1A1A18',
          color: '#AAAAAA',
        },
        '.cm-gutters': {
          backgroundColor: '#111111',
          color: '#5E5E5C',
          border: 'none',
        },
        '.cm-scroller': {
          overflow: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: '#5E5E5C40 transparent',
        },
        '&.cm-focused': {
          outline: 'none',
        },
      }, { dark: true }),

      // Yjs collaborative binding with remote cursors
      yCollab(this._provider.ytext, this._provider.awareness, { undoManager }),
    ];

    this._studentEditor = new EditorView({
      state: EditorState.create({ extensions }),
      parent: editorWrapper,
    });

    // Track awareness for user count
    this._provider.awareness.on('change', () => {
      this._updateUserCount();
    });

    this._updateUserCount();
  }

  /**
   * Destroy the student's editor.
   */
  _destroyStudentEditor() {
    if (this._studentEditor) {
      this._studentEditor.destroy();
      this._studentEditor = null;
    }

    if (this._studentContainer) {
      this._studentContainer.classList.remove('visible');
      setTimeout(() => {
        this._studentContainer?.remove();
        this._studentContainer = null;
      }, 300);
    }
  }

  /**
   * Update the user count display.
   */
  _updateUserCount() {
    const el = document.getElementById('collab-editor-users');
    if (!el || !this._provider) return;

    const states = this._provider.awareness.getStates();
    const count = states.size;
    const nameList = [];
    states.forEach((state) => {
      if (state.user) nameList.push(state.user.name);
    });

    const label = el.querySelector('span');
    if (label) {
      label.textContent = `${count} editor${count !== 1 ? 's' : ''} connected`;
    }
  }


  // ── MODE INDICATOR ───────────────────────────────────────────

  /**
   * Update the collab mode indicator (teacher side).
   */
  _updateModeIndicator(active) {
    let indicator = document.getElementById('collab-mode-indicator');

    if (active && !indicator) {
      indicator = document.createElement('div');
      indicator.className = 'collab-mode-indicator';
      indicator.id = 'collab-mode-indicator';
      indicator.innerHTML = `${COLLAB_ICON.edit} <span>COLLABORATIVE</span>`;
      document.body.appendChild(indicator);
      requestAnimationFrame(() => indicator.classList.add('visible'));
    } else if (!active && indicator) {
      indicator.classList.remove('visible');
      setTimeout(() => indicator.remove(), 300);
    }
  }


  // ── LIFECYCLE ────────────────────────────────────────────────

  /**
   * Check if collab mode is active.
   * @returns {boolean}
   */
  isActive() {
    return this._collabActive;
  }

  /**
   * Get the provider (for external access).
   * @returns {CollabYjsProvider | null}
   */
  getProvider() {
    return this._provider;
  }

  /**
   * Destroy everything.
   */
  destroy() {
    if (this._isTeacher && this._collabActive) {
      this._stopCollabTeacher();
    } else if (!this._isTeacher && this._collabActive) {
      this._stopCollabStudent();
    }

    if (this._provider) {
      this._provider.destroy();
      this._provider = null;
    }

    this._collabActive = false;
  }
}

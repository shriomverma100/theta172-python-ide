/**
 * THETA172 — Collab Interactions Manager
 * Handles all collaborative interaction features:
 *
 *   - HIGHLIGHT:  Teacher highlights a line in student code (or vice versa)
 *   - RAISE_HAND: Student raises hand to ask for help
 *   - ANNOTATION: Teacher adds a quick text note on a line
 *   - ATTENTION:  Teacher requests all students' attention
 *   - REACTION:   Quick emoji-free reactions (thumbs up, check, etc.)
 *
 * All interactions are rendered as transient overlays on the code editor.
 * They auto-dismiss after a timeout unless pinned.
 */


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** How long a highlight stays visible (ms) */
const HIGHLIGHT_DURATION = 5000;

/** How long a raise-hand indicator stays (ms) — until dismissed */
const RAISE_HAND_TIMEOUT = 120000;

/** How long an annotation stays visible (ms) */
const ANNOTATION_DURATION = 15000;

/** How long an attention request overlay stays (ms) */
const ATTENTION_DURATION = 4000;

/** How long a reaction stays visible (ms) */
const REACTION_DURATION = 3000;

/** Max active highlights */
const MAX_HIGHLIGHTS = 10;

/** Max active annotations */
const MAX_ANNOTATIONS = 20;


// ══════════════════════════════════════════════════════════════════
// INTERACTION TYPES
// ══════════════════════════════════════════════════════════════════

export const INTERACTION = {
  HIGHLIGHT:   'interaction_highlight',
  RAISE_HAND:  'interaction_raise_hand',
  LOWER_HAND:  'interaction_lower_hand',
  ANNOTATION:  'interaction_annotation',
  ATTENTION:   'interaction_attention',
  REACTION:    'interaction_reaction',
};

/** Reaction types (no emoji — custom SVG graphics) */
export const REACTIONS = {
  THUMBS_UP:  'thumbs_up',
  CHECK:      'check',
  QUESTION:   'question',
  STAR:       'star',
  EYES:       'eyes',
};


// ══════════════════════════════════════════════════════════════════
// SVG ICONS (no emojis — per user's requirement)
// ══════════════════════════════════════════════════════════════════

const ICON = {
  hand_raised: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 00-2-2 2 2 0 00-2 2"/><path d="M14 10V4a2 2 0 00-2-2 2 2 0 00-2 2v2"/><path d="M10 10.5V6a2 2 0 00-2-2 2 2 0 00-2 2v8"/><path d="M18 8a2 2 0 012 2v7a5 5 0 01-5 5H9a5 5 0 01-5-5v-1"/></svg>`,

  highlight: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,

  annotation: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,

  attention: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,

  thumbs_up: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/></svg>`,

  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,

  question: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,

  star: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,

  eyes: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,

  close: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};


// ══════════════════════════════════════════════════════════════════
// INTERACTIONS MANAGER
// ══════════════════════════════════════════════════════════════════

export class InteractionsManager {
  constructor() {
    /** @type {Map<string, HTMLElement>} - Active highlight elements */
    this._highlights = new Map();

    /** @type {Map<string, HTMLElement>} - Active annotations */
    this._annotations = new Map();

    /** @type {Map<string, Object>} - Raised hands keyed by viewer ID */
    this._raisedHands = new Map();

    /** @type {HTMLElement | null} - Attention overlay */
    this._attentionOverlay = null;

    /** @type {HTMLElement | null} - Raise hand button container */
    this._handPanel = null;

    /** @type {HTMLElement | null} - Reactions bar */
    this._reactionsBar = null;

    /** @type {HTMLElement | null} - Container for hand indicators (teacher side) */
    this._handsContainer = null;

    /** @type {Function | null} - Send interaction to network */
    this.onSendInteraction = null;

    /** @type {Function | null} - Notify when hand status changes */
    this.onHandStatusChange = null;

    /** @type {boolean} */
    this._isTeacher = false;

    /** @type {boolean} */
    this._handRaised = false;

    /** @type {number} - Counter for unique IDs */
    this._idCounter = 0;
  }


  // ── INITIALIZATION ────────────────────────────────────────────

  /**
   * Initialize as teacher (sharer) or student (viewer).
   * @param {Object} options
   * @param {boolean} options.isTeacher
   * @param {Function} options.onSend - Called to send interaction over network
   * @param {HTMLElement} options.container - Container to attach UI elements
   */
  init(options) {
    this._isTeacher = options.isTeacher || false;
    this.onSendInteraction = options.onSend || null;

    const container = options.container || document.body;

    if (this._isTeacher) {
      this._buildTeacherUI(container);
    } else {
      this._buildStudentUI(container);
    }
  }

  /**
   * Destroy all UI and cleanup.
   */
  destroy() {
    // Remove all highlights
    for (const [, el] of this._highlights) {
      el.remove();
    }
    this._highlights.clear();

    // Remove all annotations
    for (const [, el] of this._annotations) {
      el.remove();
    }
    this._annotations.clear();

    // Remove raised hands
    this._raisedHands.clear();

    // Remove UI elements
    if (this._handPanel) { this._handPanel.remove(); this._handPanel = null; }
    if (this._reactionsBar) { this._reactionsBar.remove(); this._reactionsBar = null; }
    if (this._handsContainer) { this._handsContainer.remove(); this._handsContainer = null; }
    if (this._attentionOverlay) { this._attentionOverlay.remove(); this._attentionOverlay = null; }
  }


  // ── RECEIVE INTERACTION ───────────────────────────────────────

  /**
   * Handle an incoming interaction from the network.
   * @param {Object} interaction
   * @param {string} interaction.type
   * @param {Object} interaction.payload
   * @param {string} interaction.senderName
   * @param {string} interaction.senderId
   */
  handleIncoming(interaction) {
    switch (interaction.type) {
      case INTERACTION.HIGHLIGHT:
        this._showHighlight(interaction.payload, interaction.senderName);
        break;

      case INTERACTION.RAISE_HAND:
        this._showRaisedHand(interaction.senderId, interaction.senderName);
        break;

      case INTERACTION.LOWER_HAND:
        this._hideRaisedHand(interaction.senderId);
        break;

      case INTERACTION.ANNOTATION:
        this._showAnnotation(interaction.payload, interaction.senderName);
        break;

      case INTERACTION.ATTENTION:
        this._showAttention(interaction.senderName);
        break;

      case INTERACTION.REACTION:
        this._showReaction(interaction.payload, interaction.senderName);
        break;

      default:
        console.warn('[INTERACTIONS] Unknown type:', interaction.type);
    }
  }


  // ══════════════════════════════════════════════════════════════
  // HIGHLIGHT
  // ══════════════════════════════════════════════════════════════

  /**
   * Send a highlight for a specific line.
   * @param {number} line - Line number to highlight
   * @param {string} color - CSS color (default: #FF3300)
   */
  sendHighlight(line, color) {
    const payload = {
      line: line,
      color: color || '#FF3300',
      duration: HIGHLIGHT_DURATION,
    };

    // Show locally
    this._showHighlight(payload, 'You');

    // Send to network
    this._send(INTERACTION.HIGHLIGHT, payload);
  }

  /**
   * Render a highlight overlay on the code editor.
   */
  _showHighlight(payload, senderName) {
    const id = `hl-${this._nextId()}`;
    const line = payload.line || 1;
    const color = payload.color || '#FF3300';
    const duration = payload.duration || HIGHLIGHT_DURATION;

    // Cap active highlights
    if (this._highlights.size >= MAX_HIGHLIGHTS) {
      const oldest = this._highlights.keys().next().value;
      this._removeHighlight(oldest);
    }

    // Create highlight element
    const el = document.createElement('div');
    el.className = 'collab-highlight';
    el.id = id;
    el.style.setProperty('--hl-color', color);

    const lineHeight = 20; // px
    el.style.top = `${(line - 1) * lineHeight}px`;

    // Label
    const label = document.createElement('span');
    label.className = 'collab-highlight__label';
    label.innerHTML = `${ICON.highlight} <span>${senderName} -- Line ${line}</span>`;
    el.appendChild(label);

    // Attach to editor
    const codeWrapper = document.querySelector('.cm-content')
      || document.querySelector('.collab-viewer-overlay__code')
      || document.querySelector('.teacher-dashboard__expanded-code');

    if (codeWrapper) {
      const parent = codeWrapper.parentElement;
      if (parent) {
        parent.style.position = 'relative';
        parent.appendChild(el);
      }
    }

    this._highlights.set(id, el);

    // Animate in
    requestAnimationFrame(() => {
      el.classList.add('visible');
    });

    // Auto-dismiss
    setTimeout(() => {
      this._removeHighlight(id);
    }, duration);
  }

  _removeHighlight(id) {
    const el = this._highlights.get(id);
    if (!el) return;

    el.classList.remove('visible');
    el.classList.add('dismissing');

    setTimeout(() => {
      el.remove();
      this._highlights.delete(id);
    }, 300);
  }


  // ══════════════════════════════════════════════════════════════
  // RAISE HAND
  // ══════════════════════════════════════════════════════════════

  /**
   * Toggle raise/lower hand (student side).
   */
  toggleRaiseHand() {
    this._handRaised = !this._handRaised;

    if (this._handRaised) {
      this._send(INTERACTION.RAISE_HAND, {});
      this._updateHandButton(true);
    } else {
      this._send(INTERACTION.LOWER_HAND, {});
      this._updateHandButton(false);
    }
  }

  /**
   * Show a raised hand indicator (teacher side).
   */
  _showRaisedHand(viewerId, viewerName) {
    if (this._raisedHands.has(viewerId)) return;

    const handInfo = {
      id: viewerId,
      name: viewerName,
      timestamp: Date.now(),
    };
    this._raisedHands.set(viewerId, handInfo);

    // Create hand indicator UI (teacher side)
    if (this._handsContainer) {
      const indicator = document.createElement('div');
      indicator.className = 'collab-hand-indicator';
      indicator.id = `hand-${viewerId}`;

      indicator.innerHTML = `
        ${ICON.hand_raised}
        <span class="collab-hand-indicator__name">${viewerName}</span>
        <button class="collab-hand-indicator__dismiss" title="Dismiss">${ICON.close}</button>
      `;

      const dismissBtn = indicator.querySelector('.collab-hand-indicator__dismiss');
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._hideRaisedHand(viewerId);
      });

      this._handsContainer.appendChild(indicator);

      // Animate in
      requestAnimationFrame(() => {
        indicator.classList.add('visible');
      });
    }

    if (this.onHandStatusChange) {
      this.onHandStatusChange(this._raisedHands.size);
    }

    // Auto-timeout
    setTimeout(() => {
      this._hideRaisedHand(viewerId);
    }, RAISE_HAND_TIMEOUT);
  }

  /**
   * Hide a raised hand indicator.
   */
  _hideRaisedHand(viewerId) {
    this._raisedHands.delete(viewerId);

    const indicator = document.getElementById(`hand-${viewerId}`);
    if (indicator) {
      indicator.classList.remove('visible');
      indicator.classList.add('dismissing');
      setTimeout(() => indicator.remove(), 300);
    }

    if (this.onHandStatusChange) {
      this.onHandStatusChange(this._raisedHands.size);
    }
  }

  _updateHandButton(raised) {
    const btn = document.getElementById('collab-raise-hand-btn');
    if (btn) {
      btn.classList.toggle('raised', raised);
      const label = btn.querySelector('.collab-hand-btn__label');
      if (label) label.textContent = raised ? 'Lower Hand' : 'Raise Hand';
    }
  }


  // ══════════════════════════════════════════════════════════════
  // ANNOTATION
  // ══════════════════════════════════════════════════════════════

  /**
   * Send an annotation on a specific line.
   * @param {number} line
   * @param {string} text
   */
  sendAnnotation(line, text) {
    if (!text || !text.trim()) return;

    const payload = {
      line: line,
      text: text.trim().substring(0, 200),
      duration: ANNOTATION_DURATION,
    };

    this._showAnnotation(payload, 'You');
    this._send(INTERACTION.ANNOTATION, payload);
  }

  _showAnnotation(payload, senderName) {
    const id = `ann-${this._nextId()}`;
    const line = payload.line || 1;
    const text = payload.text || '';
    const duration = payload.duration || ANNOTATION_DURATION;

    if (this._annotations.size >= MAX_ANNOTATIONS) {
      const oldest = this._annotations.keys().next().value;
      this._removeAnnotation(oldest);
    }

    const el = document.createElement('div');
    el.className = 'collab-annotation';
    el.id = id;

    const lineHeight = 20;
    el.style.top = `${(line - 1) * lineHeight}px`;

    el.innerHTML = `
      <div class="collab-annotation__header">
        ${ICON.annotation}
        <span class="collab-annotation__sender">${senderName}</span>
        <span class="collab-annotation__line">Line ${line}</span>
        <button class="collab-annotation__close">${ICON.close}</button>
      </div>
      <div class="collab-annotation__text">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    `;

    const closeBtn = el.querySelector('.collab-annotation__close');
    closeBtn.addEventListener('click', () => this._removeAnnotation(id));

    const codeWrapper = document.querySelector('.cm-content')
      || document.querySelector('.collab-viewer-overlay__code')
      || document.querySelector('.teacher-dashboard__expanded-code');

    if (codeWrapper) {
      const parent = codeWrapper.parentElement;
      if (parent) {
        parent.style.position = 'relative';
        parent.appendChild(el);
      }
    }

    this._annotations.set(id, el);

    requestAnimationFrame(() => {
      el.classList.add('visible');
    });

    setTimeout(() => {
      this._removeAnnotation(id);
    }, duration);
  }

  _removeAnnotation(id) {
    const el = this._annotations.get(id);
    if (!el) return;

    el.classList.remove('visible');
    el.classList.add('dismissing');

    setTimeout(() => {
      el.remove();
      this._annotations.delete(id);
    }, 300);
  }


  // ══════════════════════════════════════════════════════════════
  // ATTENTION
  // ══════════════════════════════════════════════════════════════

  /**
   * Send an attention request to all students (teacher only).
   */
  sendAttention() {
    if (!this._isTeacher) return;

    this._showAttention('Teacher');
    this._send(INTERACTION.ATTENTION, {});
  }

  _showAttention(senderName) {
    // Remove any existing attention overlay
    if (this._attentionOverlay) {
      this._attentionOverlay.remove();
      this._attentionOverlay = null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'collab-attention';
    overlay.id = 'collab-attention-overlay';

    overlay.innerHTML = `
      <div class="collab-attention__content">
        ${ICON.attention}
        <h3 class="collab-attention__title">ATTENTION</h3>
        <p class="collab-attention__desc">${senderName} is requesting your attention</p>
      </div>
    `;

    document.body.appendChild(overlay);
    this._attentionOverlay = overlay;

    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });

    setTimeout(() => {
      if (this._attentionOverlay === overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => {
          overlay.remove();
          if (this._attentionOverlay === overlay) {
            this._attentionOverlay = null;
          }
        }, 400);
      }
    }, ATTENTION_DURATION);
  }


  // ══════════════════════════════════════════════════════════════
  // REACTIONS
  // ══════════════════════════════════════════════════════════════

  /**
   * Send a reaction.
   * @param {string} reactionType - One of REACTIONS values
   */
  sendReaction(reactionType) {
    const payload = { reaction: reactionType };
    this._showReaction(payload, 'You');
    this._send(INTERACTION.REACTION, payload);
  }

  _showReaction(payload, senderName) {
    const reaction = payload.reaction || REACTIONS.THUMBS_UP;
    const icon = ICON[reaction] || ICON.thumbs_up;

    // Create floating reaction
    const el = document.createElement('div');
    el.className = 'collab-reaction';

    el.innerHTML = `
      <div class="collab-reaction__icon">${icon}</div>
      <span class="collab-reaction__sender">${senderName}</span>
    `;

    // Random horizontal position
    const left = 60 + Math.random() * 30;
    el.style.left = `${left}%`;

    document.body.appendChild(el);

    requestAnimationFrame(() => {
      el.classList.add('visible');
    });

    setTimeout(() => {
      el.classList.add('fading');
      setTimeout(() => el.remove(), 500);
    }, REACTION_DURATION);
  }


  // ══════════════════════════════════════════════════════════════
  // UI BUILDERS
  // ══════════════════════════════════════════════════════════════

  /**
   * Build teacher-side interaction UI.
   * - Raised hands container (floating)
   * - Highlight + Annotation tools in dashboard
   */
  _buildTeacherUI(container) {
    // Raised hands container (floating panel)
    this._handsContainer = document.createElement('div');
    this._handsContainer.className = 'collab-hands-container';
    this._handsContainer.id = 'collab-hands-container';

    const handsTitle = document.createElement('div');
    handsTitle.className = 'collab-hands-container__title';
    handsTitle.innerHTML = `${ICON.hand_raised} <span>Raised Hands</span>`;

    this._handsContainer.appendChild(handsTitle);
    container.appendChild(this._handsContainer);

    // Reactions bar
    this._buildReactionsBar(container);
  }

  /**
   * Build student-side interaction UI.
   * - Raise hand button
   * - Reactions bar
   */
  _buildStudentUI(container) {
    // Raise hand button
    this._handPanel = document.createElement('div');
    this._handPanel.className = 'collab-hand-panel';

    const handBtn = document.createElement('button');
    handBtn.className = 'collab-hand-btn';
    handBtn.id = 'collab-raise-hand-btn';
    handBtn.innerHTML = `${ICON.hand_raised} <span class="collab-hand-btn__label">Raise Hand</span>`;
    handBtn.addEventListener('click', () => this.toggleRaiseHand());

    this._handPanel.appendChild(handBtn);
    container.appendChild(this._handPanel);

    // Reactions bar
    this._buildReactionsBar(container);
  }

  /**
   * Build the reactions bar (shared between teacher and student).
   */
  _buildReactionsBar(container) {
    this._reactionsBar = document.createElement('div');
    this._reactionsBar.className = 'collab-reactions-bar';

    const reactionTypes = [
      { type: REACTIONS.THUMBS_UP, label: 'Good', icon: ICON.thumbs_up },
      { type: REACTIONS.CHECK, label: 'Done', icon: ICON.check },
      { type: REACTIONS.QUESTION, label: 'Question', icon: ICON.question },
      { type: REACTIONS.STAR, label: 'Great', icon: ICON.star },
      { type: REACTIONS.EYES, label: 'Looking', icon: ICON.eyes },
    ];

    reactionTypes.forEach(({ type, label, icon }) => {
      const btn = document.createElement('button');
      btn.className = 'collab-reaction-btn';
      btn.title = label;
      btn.innerHTML = icon;
      btn.addEventListener('click', () => this.sendReaction(type));
      this._reactionsBar.appendChild(btn);
    });

    container.appendChild(this._reactionsBar);
  }


  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════

  _send(type, payload) {
    if (this.onSendInteraction) {
      this.onSendInteraction({ type, payload });
    }
  }

  _nextId() {
    return ++this._idCounter;
  }

  /**
   * Get current raised hand count (for status display).
   */
  getRaisedHandCount() {
    return this._raisedHands.size;
  }

  /**
   * Check if this student's hand is raised.
   */
  isHandRaised() {
    return this._handRaised;
  }
}

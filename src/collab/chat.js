/**
 * THETA172 — Collab Chat System
 * Persistent text chat sidebar for teacher-student communication.
 *
 * Features:
 *   - Floating chat toggle button with unread badge
 *   - Slide-in sidebar panel
 *   - Message history (session-scoped, max 200 messages)
 *   - Typing indicator
 *   - Auto-scroll on new messages
 *   - System messages (join/leave/errors)
 *   - Timestamp display
 *   - Input with Enter-to-send, Shift+Enter for newline
 */

import '../styles/chat.css';


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

const MAX_MESSAGES = 200;
const MAX_MESSAGE_LENGTH = 500;
const TYPING_TIMEOUT = 3000;
const TYPING_DEBOUNCE = 800;


// ══════════════════════════════════════════════════════════════════
// CHAT MESSAGE TYPES
// ══════════════════════════════════════════════════════════════════

export const CHAT_MSG = {
  TEXT:    'chat_text',
  TYPING: 'chat_typing',
  SYSTEM: 'chat_system',
};


// ══════════════════════════════════════════════════════════════════
// SVG ICONS
// ══════════════════════════════════════════════════════════════════

const CHAT_ICON = {
  chat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,

  send: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,

  close: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

  minimize: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
};


// ══════════════════════════════════════════════════════════════════
// CHAT MANAGER
// ══════════════════════════════════════════════════════════════════

export class ChatManager {
  constructor() {
    /** @type {Array<Object>} - Message history */
    this._messages = [];

    /** @type {HTMLElement | null} - Chat toggle button */
    this._toggleBtn = null;

    /** @type {HTMLElement | null} - Chat panel element */
    this._panel = null;

    /** @type {HTMLElement | null} - Messages container */
    this._messagesContainer = null;

    /** @type {HTMLElement | null} - Input textarea */
    this._input = null;

    /** @type {HTMLElement | null} - Typing indicator */
    this._typingIndicator = null;

    /** @type {boolean} */
    this._isOpen = false;

    /** @type {number} - Unread message count */
    this._unreadCount = 0;

    /** @type {string} - Current user's name */
    this._userName = '';

    /** @type {boolean} - Is this user the teacher */
    this._isTeacher = false;

    /** @type {Function | null} - Send message callback */
    this.onSendMessage = null;

    /** @type {Function | null} - Send typing indicator callback */
    this.onSendTyping = null;

    /** @type {Map<string, number>} - Active typing indicators by sender */
    this._typingUsers = new Map();

    /** @type {number | null} - Typing debounce timer */
    this._typingTimer = null;

    /** @type {number} - Message ID counter */
    this._idCounter = 0;
  }


  // ── INITIALIZATION ────────────────────────────────────────────

  /**
   * Initialize the chat system.
   * @param {Object} options
   * @param {string} options.userName - Current user's display name
   * @param {boolean} options.isTeacher - Whether this user is the teacher
   * @param {Function} options.onSend - Called to send a message over network
   * @param {Function} options.onTyping - Called to send typing indicator
   */
  init(options) {
    this._userName = options.userName || 'User';
    this._isTeacher = options.isTeacher || false;
    this.onSendMessage = options.onSend || null;
    this.onSendTyping = options.onTyping || null;

    this._buildUI();
    this._addSystemMessage(`Chat started. You are ${this._isTeacher ? 'the teacher' : 'a student'}.`);
  }

  /**
   * Destroy the chat and remove all UI.
   */
  destroy() {
    if (this._toggleBtn) {
      this._toggleBtn.remove();
      this._toggleBtn = null;
    }
    if (this._panel) {
      this._panel.remove();
      this._panel = null;
    }
    this._messages = [];
    this._typingUsers.clear();
    if (this._typingTimer) {
      clearTimeout(this._typingTimer);
      this._typingTimer = null;
    }
  }


  // ── RECEIVE MESSAGE ───────────────────────────────────────────

  /**
   * Handle an incoming chat message from the network.
   * @param {Object} data
   * @param {string} data.type - CHAT_MSG type
   * @param {string} data.senderName
   * @param {string} data.senderId
   * @param {string} data.text
   * @param {number} data.timestamp
   */
  handleIncoming(data) {
    switch (data.type) {
      case CHAT_MSG.TEXT:
        this._addMessage({
          id: `msg-${++this._idCounter}`,
          sender: data.senderName || 'Unknown',
          senderId: data.senderId || '',
          text: data.text || '',
          timestamp: data.timestamp || Date.now(),
          isOwn: false,
          isSystem: false,
          isTeacher: data.isTeacher || false,
        });
        break;

      case CHAT_MSG.TYPING:
        this._showTypingIndicator(data.senderName || 'Someone');
        break;

      case CHAT_MSG.SYSTEM:
        this._addSystemMessage(data.text || '');
        break;
    }
  }


  // ── SEND MESSAGE ──────────────────────────────────────────────

  /**
   * Send a text message.
   * @param {string} text
   */
  sendMessage(text) {
    if (!text || !text.trim()) return;

    const sanitized = text.trim().substring(0, MAX_MESSAGE_LENGTH);

    const msg = {
      id: `msg-${++this._idCounter}`,
      sender: this._userName,
      senderId: 'self',
      text: sanitized,
      timestamp: Date.now(),
      isOwn: true,
      isSystem: false,
      isTeacher: this._isTeacher,
    };

    this._addMessage(msg);

    // Send over network
    if (this.onSendMessage) {
      this.onSendMessage({
        type: CHAT_MSG.TEXT,
        text: sanitized,
        senderName: this._userName,
        isTeacher: this._isTeacher,
        timestamp: msg.timestamp,
      });
    }
  }

  /**
   * Notify network that user is typing.
   */
  _emitTyping() {
    if (this._typingTimer) return; // Already sent recently

    if (this.onSendTyping) {
      this.onSendTyping({
        type: CHAT_MSG.TYPING,
        senderName: this._userName,
      });
    }

    this._typingTimer = setTimeout(() => {
      this._typingTimer = null;
    }, TYPING_DEBOUNCE);
  }


  // ── MESSAGE MANAGEMENT ────────────────────────────────────────

  _addMessage(msg) {
    this._messages.push(msg);

    // Cap history
    if (this._messages.length > MAX_MESSAGES) {
      this._messages.shift();
      // Remove oldest DOM node
      if (this._messagesContainer && this._messagesContainer.firstChild) {
        this._messagesContainer.removeChild(this._messagesContainer.firstChild);
      }
    }

    // Render message
    this._renderMessage(msg);

    // Update unread count if panel is closed
    if (!this._isOpen && !msg.isOwn) {
      this._unreadCount++;
      this._updateBadge();
    }
  }

  _addSystemMessage(text) {
    this._addMessage({
      id: `sys-${++this._idCounter}`,
      sender: 'System',
      senderId: 'system',
      text: text,
      timestamp: Date.now(),
      isOwn: false,
      isSystem: true,
      isTeacher: false,
    });
  }


  // ── TYPING INDICATOR ──────────────────────────────────────────

  _showTypingIndicator(senderName) {
    this._typingUsers.set(senderName, Date.now());
    this._updateTypingDisplay();

    // Auto-clear after timeout
    setTimeout(() => {
      this._typingUsers.delete(senderName);
      this._updateTypingDisplay();
    }, TYPING_TIMEOUT);
  }

  _updateTypingDisplay() {
    if (!this._typingIndicator) return;

    const names = Array.from(this._typingUsers.keys());

    if (names.length === 0) {
      this._typingIndicator.classList.remove('visible');
      return;
    }

    let text = '';
    if (names.length === 1) {
      text = `${names[0]} is typing`;
    } else if (names.length === 2) {
      text = `${names[0]} and ${names[1]} are typing`;
    } else {
      text = `${names.length} people are typing`;
    }

    const label = this._typingIndicator.querySelector('.chat-typing__text');
    if (label) label.textContent = text;

    this._typingIndicator.classList.add('visible');
  }


  // ══════════════════════════════════════════════════════════════
  // UI BUILDING
  // ══════════════════════════════════════════════════════════════

  _buildUI() {
    // ── Toggle Button ──
    this._toggleBtn = document.createElement('button');
    this._toggleBtn.className = 'chat-toggle';
    this._toggleBtn.id = 'chat-toggle-btn';
    this._toggleBtn.title = 'Open Chat';
    this._toggleBtn.innerHTML = CHAT_ICON.chat;

    const badge = document.createElement('span');
    badge.className = 'chat-toggle__badge';
    badge.id = 'chat-badge';
    badge.textContent = '0';
    this._toggleBtn.appendChild(badge);

    this._toggleBtn.addEventListener('click', () => this.toggle());
    document.body.appendChild(this._toggleBtn);

    // ── Chat Panel ──
    this._panel = document.createElement('div');
    this._panel.className = 'chat-panel';
    this._panel.id = 'chat-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'chat-panel__header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'chat-panel__header-left';

    const headerIcon = document.createElement('span');
    headerIcon.className = 'chat-panel__header-icon';
    headerIcon.innerHTML = CHAT_ICON.chat;

    const headerTitle = document.createElement('span');
    headerTitle.className = 'chat-panel__header-title';
    headerTitle.textContent = 'CHAT';

    const headerCount = document.createElement('span');
    headerCount.className = 'chat-panel__header-count';
    headerCount.id = 'chat-msg-count';
    headerCount.textContent = '0';

    headerLeft.appendChild(headerIcon);
    headerLeft.appendChild(headerTitle);
    headerLeft.appendChild(headerCount);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'chat-panel__close';
    closeBtn.title = 'Close chat';
    closeBtn.innerHTML = CHAT_ICON.close;
    closeBtn.addEventListener('click', () => this.toggle());

    header.appendChild(headerLeft);
    header.appendChild(closeBtn);
    this._panel.appendChild(header);

    // Messages container
    this._messagesContainer = document.createElement('div');
    this._messagesContainer.className = 'chat-messages';
    this._messagesContainer.id = 'chat-messages';
    this._panel.appendChild(this._messagesContainer);

    // Typing indicator
    this._typingIndicator = document.createElement('div');
    this._typingIndicator.className = 'chat-typing';

    const typingDots = document.createElement('span');
    typingDots.className = 'chat-typing__dots';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'chat-typing__dot';
      typingDots.appendChild(dot);
    }

    const typingText = document.createElement('span');
    typingText.className = 'chat-typing__text';
    typingText.textContent = '';

    this._typingIndicator.appendChild(typingDots);
    this._typingIndicator.appendChild(typingText);
    this._panel.appendChild(this._typingIndicator);

    // Input area
    const inputArea = document.createElement('div');
    inputArea.className = 'chat-input-area';

    this._input = document.createElement('textarea');
    this._input.className = 'chat-input';
    this._input.id = 'chat-input';
    this._input.placeholder = 'Type a message...';
    this._input.rows = 1;
    this._input.maxLength = MAX_MESSAGE_LENGTH;

    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._handleSend();
      }
    });

    this._input.addEventListener('input', () => {
      this._autoResizeInput();
      this._emitTyping();
    });

    const sendBtn = document.createElement('button');
    sendBtn.className = 'chat-send-btn';
    sendBtn.id = 'chat-send-btn';
    sendBtn.title = 'Send message';
    sendBtn.innerHTML = CHAT_ICON.send;
    sendBtn.addEventListener('click', () => this._handleSend());

    inputArea.appendChild(this._input);
    inputArea.appendChild(sendBtn);
    this._panel.appendChild(inputArea);

    document.body.appendChild(this._panel);
  }


  // ══════════════════════════════════════════════════════════════
  // MESSAGE RENDERING
  // ══════════════════════════════════════════════════════════════

  _renderMessage(msg) {
    if (!this._messagesContainer) return;

    const el = document.createElement('div');
    el.className = 'chat-message';
    el.id = msg.id;

    if (msg.isOwn) el.classList.add('chat-message--own');
    if (msg.isSystem) el.classList.add('chat-message--system');
    if (msg.isTeacher && !msg.isOwn) el.classList.add('chat-message--teacher');

    if (msg.isSystem) {
      const text = document.createElement('span');
      text.className = 'chat-message__system-text';
      text.textContent = msg.text;
      el.appendChild(text);
    } else {
      // Sender name
      if (!msg.isOwn) {
        const sender = document.createElement('div');
        sender.className = 'chat-message__sender';
        sender.textContent = msg.sender;
        if (msg.isTeacher) {
          const badge = document.createElement('span');
          badge.className = 'chat-message__teacher-badge';
          badge.textContent = 'TEACHER';
          sender.appendChild(badge);
        }
        el.appendChild(sender);
      }

      // Message text
      const textEl = document.createElement('div');
      textEl.className = 'chat-message__text';
      textEl.textContent = msg.text;
      el.appendChild(textEl);

      // Timestamp
      const time = document.createElement('span');
      time.className = 'chat-message__time';
      time.textContent = this._formatTime(msg.timestamp);
      el.appendChild(time);
    }

    this._messagesContainer.appendChild(el);

    // Animate in
    requestAnimationFrame(() => {
      el.classList.add('visible');
    });

    // Auto-scroll
    this._scrollToBottom();

    // Update count
    this._updateMessageCount();
  }

  _scrollToBottom() {
    if (this._messagesContainer) {
      requestAnimationFrame(() => {
        this._messagesContainer.scrollTop = this._messagesContainer.scrollHeight;
      });
    }
  }


  // ══════════════════════════════════════════════════════════════
  // UI ACTIONS
  // ══════════════════════════════════════════════════════════════

  toggle() {
    this._isOpen = !this._isOpen;

    if (this._panel) {
      this._panel.classList.toggle('open', this._isOpen);
    }

    if (this._toggleBtn) {
      this._toggleBtn.classList.toggle('active', this._isOpen);
    }

    if (this._isOpen) {
      this._unreadCount = 0;
      this._updateBadge();
      this._scrollToBottom();

      // Focus input
      setTimeout(() => {
        if (this._input) this._input.focus();
      }, 300);
    }
  }

  /**
   * Show the chat panel.
   */
  show() {
    if (!this._isOpen) this.toggle();
  }

  /**
   * Hide the chat panel.
   */
  hide() {
    if (this._isOpen) this.toggle();
  }

  _handleSend() {
    if (!this._input) return;

    const text = this._input.value.trim();
    if (!text) return;

    this.sendMessage(text);
    this._input.value = '';
    this._autoResizeInput();
    this._input.focus();
  }

  _autoResizeInput() {
    if (!this._input) return;
    this._input.style.height = 'auto';
    const maxHeight = 100;
    this._input.style.height = Math.min(this._input.scrollHeight, maxHeight) + 'px';
  }

  _updateBadge() {
    const badge = document.getElementById('chat-badge');
    if (badge) {
      badge.textContent = String(this._unreadCount);
      badge.classList.toggle('visible', this._unreadCount > 0);
    }
  }

  _updateMessageCount() {
    const countEl = document.getElementById('chat-msg-count');
    if (countEl) {
      countEl.textContent = String(this._messages.length);
    }
  }

  _formatTime(ts) {
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }

  /**
   * Get message count.
   */
  getMessageCount() {
    return this._messages.length;
  }

  /**
   * Check if panel is open.
   */
  isOpen() {
    return this._isOpen;
  }
}

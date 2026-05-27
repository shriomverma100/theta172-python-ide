/**
 * THETA172 — Collab WebSocket Client
 * Runs in the renderer process.
 * Used by viewers to connect to a sharer's WebSocket server.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff
 *   - Heartbeat keep-alive
 *   - Clean disconnect handling
 *   - Event-driven API via callbacks
 */

import {
  MSG, ERR,
  createMessage, parseMessage,
  isValidRoomKey,
  HEARTBEAT_INTERVAL,
  HEARTBEAT_TIMEOUT,
} from './collab-protocol.js';


import { IConnection } from './IConnection.js';

// ══════════════════════════════════════════════════════════════════
// CLIENT CLASS
// ══════════════════════════════════════════════════════════════════

export class CollabClient extends IConnection {
  constructor() {
    super();
    /** @type {WebSocket | null} */
    this.ws = null;

    /** @type {boolean} - Whether the client has been destroyed */
    this._destroyed = false;

    /** @type {string} */
    this.serverUrl = '';

    /** @type {string} */
    this.roomKey = '';

    /** @type {string} */
    this.clientId = '';

    /** @type {string} */
    this.clientName = '';

    /** @type {'disconnected' | 'connecting' | 'connected'} */
    this.status = 'disconnected';

    /** @type {number} */
    this.reconnectAttempts = 0;

    /** @type {number} - Max reconnect attempts before giving up */
    this.maxReconnectAttempts = 5;

    /** @type {NodeJS.Timer | null} */
    this.heartbeatTimer = null;

    /** @type {number} */
    this.lastHeartbeat = 0;

    /** @type {NodeJS.Timer | null} */
    this.reconnectTimer = null;

    /** @type {boolean} - If true, don't auto-reconnect (user disconnected) */
    this.intentionalDisconnect = false;

    /** @type {string} - Room password (empty = no password) */
    this.password = '';

    // ── Callbacks ──
    /** @type {Function | null} */
    this.onConnected = null;

    /** @type {Function | null} */
    this.onDisconnected = null;

    /** @type {Function | null} */
    this.onStateFullReceived = null;

    /** @type {Function | null} */
    this.onStateUpdateReceived = null;

    /** @type {Function | null} */
    this.onHighlightReceived = null;

    /** @type {Function | null} */
    this.onPeerJoined = null;

    /** @type {Function | null} */
    this.onPeerLeft = null;

    /** @type {Function | null} */
    this.onError = null;

    /** @type {Function | null} */
    this.onRoomClosed = null;

    /** @type {Function | null} */
    this.onInteractionReceived = null;

    /** @type {Function | null} */
    this.onChatReceived = null;

    /** @type {Function | null} */
    this.onCrdtReceived = null;

    /** @type {Function | null} */
    this.onAwarenessReceived = null;

    /** @type {Function | null} */
    this.onCollabModeChange = null;
  }


  // ── CONNECT ───────────────────────────────────────────────────

  /**
   * Connect to a collab server.
   * @param {Object} options
   * @param {string} options.host      - Server IP or hostname
   * @param {number} options.port      - Server port
   * @param {string} options.roomKey   - Room key to join
   * @param {string} options.name      - This viewer's display name
   * @param {string} [options.clientId] - Unique client ID (auto-generated if not provided)
   * @returns {Promise<void>}
   */
  connect(options) {
    return new Promise(async (resolve, reject) => {
      if (this._destroyed) {
        reject(new Error('Client has been destroyed'));
        return;
      }
      if (this.status === 'connecting') {
        reject(new Error('Connection already in progress'));
        return;
      }
      if (this.status === 'connected') {
        this.disconnect();
      }

      this.roomKey = options.roomKey;
      this.clientName = options.name || 'Viewer';
      this.clientId = options.clientId || this.generateClientId();
      this.password = options.password || '';
      this.intentionalDisconnect = false;
      this.reconnectAttempts = 0;
      this.status = 'connecting';

      const port = options.port;
      const addresses = options.addresses && options.addresses.length > 0
        ? options.addresses
        : [options.host || 'localhost'];

      console.log(`[COLLAB-CLIENT] Attempting connection to ${addresses.length} addresses on port ${port}...`);

      try {
        // Try all addresses concurrently
        this.ws = await this._connectToFastest(addresses, port);
        this.serverUrl = this.ws.url;
        console.log(`[COLLAB-CLIENT] Connected successfully to ${this.serverUrl}`);

        // Send JOIN message
        this.send(MSG.JOIN, {
          roomKey: this.roomKey,
          name: this.clientName,
          clientId: this.clientId,
          password: this.password || undefined,
        });
      } catch (err) {
        this.status = 'disconnected';
        reject(new Error(`All connection attempts failed. Make sure the sharer is on the same network or firewall is not blocking.`));
        return;
      }

      this.ws.onmessage = (event) => {
        const msg = parseMessage(event.data);
        if (!msg) return;

        this.handleMessage(msg, resolve, reject);
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.status === 'connected';
        this.status = 'disconnected';
        this.stopHeartbeat();

        console.log(`[COLLAB-CLIENT] Connection closed: ${event.code} ${event.reason}`);

        if (wasConnected) {
          if (this.onDisconnected) {
            this.onDisconnected({
              code: event.code,
              reason: event.reason || 'Connection lost',
              intentional: this.intentionalDisconnect,
            });
          }

          // Auto-reconnect if not intentional
          if (!this.intentionalDisconnect) {
            this.scheduleReconnect();
          }
        } else {
          // Connection failed before WELCOME
          reject(new Error(event.reason || 'Connection failed'));
        }
      };

      this.ws.onerror = (event) => {
        console.error('[COLLAB-CLIENT] WebSocket error');
        if (this.onError) {
          this.onError('Connection error');
        }
      };
    });
  }


  // ── DISCONNECT ────────────────────────────────────────────────

  /**
   * Explicitly disconnect from the server.
   */
  disconnect() {
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    this.cancelReconnect();

    if (this.ws) {
      // Send LEAVE message before closing
      try {
        this.send(MSG.LEAVE, { clientId: this.clientId });
      } catch (_) {}

      try {
        this.ws.close(1000, 'User disconnected');
      } catch (_) {}
      this.ws = null;
    }

    this.status = 'disconnected';
  }


  // ── MESSAGE HANDLER ───────────────────────────────────────────

  /**
   * Handle an incoming message from the server.
   * @param {Object} msg - Parsed message
   * @param {Function} resolve - Promise resolve (only for initial WELCOME)
   * @param {Function} reject - Promise reject (only for initial connection)
   */
  handleMessage(msg, resolve, reject) {
    switch (msg.type) {
      case MSG.WELCOME:
        this.status = 'connected';
        this.reconnectAttempts = 0;
        this.startHeartbeat();

        console.log(`[COLLAB-CLIENT] Joined room ${msg.payload.roomKey} (host: ${msg.payload.hostName})`);

        if (this.onConnected) {
          this.onConnected({
            roomKey: msg.payload.roomKey,
            hostName: msg.payload.hostName,
            hostId: msg.payload.hostId,
            viewerCount: msg.payload.viewerCount,
            viewers: msg.payload.viewers,
          });
        }

        if (resolve) resolve();
        break;

      case MSG.STATE_FULL:
        if (this.onStateFullReceived) {
          this.onStateFullReceived(msg.payload);
        }
        break;

      case MSG.STATE_UPDATE:
        if (this.onStateUpdateReceived) {
          this.onStateUpdateReceived(msg.payload);
        }
        break;

      case MSG.HIGHLIGHT:
        if (this.onHighlightReceived) {
          this.onHighlightReceived(msg.payload);
        }
        break;

      case MSG.PEER_JOINED:
        if (this.onPeerJoined) {
          this.onPeerJoined(msg.payload);
        }
        break;

      case MSG.PEER_LEFT:
        if (this.onPeerLeft) {
          this.onPeerLeft(msg.payload);
        }
        break;

      case MSG.ROOM_CLOSED:
        console.log('[COLLAB-CLIENT] Room closed by host');
        this.intentionalDisconnect = true; // Don't reconnect
        if (this.onRoomClosed) {
          this.onRoomClosed(msg.payload);
        }
        this.disconnect();
        break;

      case MSG.HEARTBEAT:
      case MSG.PONG:
        this.lastHeartbeat = Date.now();
        break;

      case MSG.ERROR:
        console.error(`[COLLAB-CLIENT] Server error: ${msg.payload.code} - ${msg.payload.message}`);
        if (this.onError) {
          this.onError(msg.payload.message || 'Server error');
        }

        // If error is during connection, reject the promise
        if (this.status !== 'connected' && reject) {
          reject(new Error(msg.payload.message));
        }
        break;

      case MSG.INTERACTION:
        if (this.onInteractionReceived) {
          this.onInteractionReceived(msg.payload);
        }
        break;

      case MSG.CHAT:
        if (this.onChatReceived) {
          this.onChatReceived(msg.payload);
        }
        break;

      case MSG.CRDT_SYNC:
        if (this.onCrdtReceived) {
          this.onCrdtReceived(msg.payload);
        }
        break;

      case MSG.CRDT_AWARENESS:
        if (this.onAwarenessReceived) {
          this.onAwarenessReceived(msg.payload);
        }
        break;

      case MSG.COLLAB_MODE:
        if (this.onCollabModeChange) {
          this.onCollabModeChange(msg.payload);
        }
        break;

      default:
        // Unknown message type — ignore
        break;
    }
  }


  // ── SEND HELPERS ──────────────────────────────────────────────

  /**
   * Send a message to the server.
   * @param {string} type    - Message type
   * @param {Object} payload - Message payload
   */
  send(type, payload) {
    if (this._destroyed) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Silently drop — don't spam console for expected disconnects
      return;
    }

    try {
      const msg = createMessage(type, payload, this.clientId);
      this.ws.send(msg);
    } catch (err) {
      console.warn(`[COLLAB-CLIENT] Send failed: ${err.message}`);
    }
  }

  /**
   * Request a line highlight (viewer/teacher feature).
   * @param {number} line - Line number to highlight
   */
  requestHighlight(line) {
    this.send(MSG.HIGHLIGHT_REQ, { line });
  }

  /**
   * Send an interaction (raise hand, reaction, etc.).
   * @param {Object} interaction - { type, payload }
   */
  sendInteraction(interaction) {
    this.send(MSG.INTERACTION, interaction);
  }

  /**
   * Send student IDE state to the teacher's dashboard.
   * @param {Object} state - Student's IDE state snapshot
   */
  sendStudentState(state) {
    this.send(MSG.STUDENT_STATE, state);
  }

  /**
   * Send a chat message.
   * @param {Object} chatMsg - { type, text, senderName, isTeacher, timestamp }
   */
  sendChat(chatMsg) {
    this.send(MSG.CHAT, chatMsg);
  }

  /**
   * Send a CRDT sync message.
   * @param {Object} crdtData - Encoded CRDT payload
   */
  sendCrdt(crdtData) {
    this.send(MSG.CRDT_SYNC, crdtData);
  }

  /**
   * Send a CRDT awareness update.
   * @param {Object} awarenessData - Encoded awareness payload
   */
  sendAwareness(awarenessData) {
    this.send(MSG.CRDT_AWARENESS, awarenessData);
  }

  /**
   * Send a ping to measure latency.
   */
  ping() {
    this.send(MSG.PING, { ts: Date.now() });
  }


  // ── INTERNAL CONNECTION HELPERS ────────────────────────────────
  
  /**
   * Attempt to connect to multiple IP addresses concurrently.
   * Returns the first WebSocket that successfully connects and closes the others.
   */
  _connectToFastest(addresses, port) {
    return new Promise((resolve, reject) => {
      const sockets = [];
      let resolved = false;
      const failedSet = new Set(); // Track which sockets have failed (prevent double-count)

      const cleanup = () => {
        for (const ws of sockets) {
          if (!resolved || ws !== this.ws) {
            try { ws.close(); } catch (_) {}
          }
        }
      };

      const handleFailure = (ws) => {
        if (resolved) return;
        if (failedSet.has(ws)) return; // Already counted this socket
        failedSet.add(ws);
        if (failedSet.size === addresses.length) {
          reject(new Error('All connections failed'));
        }
      };

      for (const ip of addresses) {
        try {
          const ws = new WebSocket(`ws://${ip}:${port}`);
          sockets.push(ws);

          ws.onopen = () => {
            if (resolved) {
              ws.close();
              return;
            }
            resolved = true;
            this.ws = ws; // Save winning socket
            
            // Clear other sockets' handlers and close them
            for (const otherWs of sockets) {
              if (otherWs !== ws) {
                otherWs.onopen = null;
                otherWs.onclose = null;
                otherWs.onerror = null;
                otherWs.onmessage = null;
                try { otherWs.close(); } catch (_) {}
              }
            }
            
            // Clear handlers on winning socket so we can attach the main ones
            ws.onopen = null;
            ws.onclose = null;
            ws.onerror = null;
            ws.onmessage = null;
            
            resolve(ws);
          };

          ws.onerror = () => handleFailure(ws);
          ws.onclose = () => handleFailure(ws);
        } catch (err) {
          // Synchronous error creating the WebSocket
          failedSet.add(null);
          if (failedSet.size === addresses.length && !resolved) {
            reject(new Error('All connections failed'));
          }
        }
      }

      // Overall timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('Connection timeout'));
        }
      }, 8000); // Increased from 5s to 8s for slow networks
    });
  }


  // ── HEARTBEAT ─────────────────────────────────────────────────

  startHeartbeat() {
    this.lastHeartbeat = Date.now();

    this.heartbeatTimer = setInterval(() => {
      // Check if server is still alive
      if (Date.now() - this.lastHeartbeat > HEARTBEAT_TIMEOUT) {
        console.log('[COLLAB-CLIENT] Server heartbeat timeout');
        this.ws?.close(4005, 'Heartbeat timeout');
        return;
      }

      // Send heartbeat
      this.send(MSG.HEARTBEAT, { ts: Date.now() });
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }


  // ── AUTO-RECONNECT ────────────────────────────────────────────

  scheduleReconnect() {
    if (this.intentionalDisconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[COLLAB-CLIENT] Max reconnect attempts reached');
      if (this.onError) {
        this.onError('Connection lost. Max reconnect attempts reached.');
      }
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
    this.reconnectAttempts++;

    console.log(`[COLLAB-CLIENT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      try {
        const url = new URL(this.serverUrl);
        this.connect({
          host: url.hostname,
          port: parseInt(url.port),
          roomKey: this.roomKey,
          name: this.clientName,
          clientId: this.clientId,
          password: this.password,
        }).catch((err) => {
          console.error(`[COLLAB-CLIENT] Reconnect failed: ${err.message}`);
        });
      } catch (err) {
        console.error(`[COLLAB-CLIENT] Reconnect URL parse error: ${err.message}`);
      }
    }, delay);
  }

  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }


  // ── UTILITY ───────────────────────────────────────────────────

  generateClientId() {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Get current client state.
   */
  getState() {
    return {
      status: this.status,
      roomKey: this.roomKey,
      clientName: this.clientName,
      clientId: this.clientId,
      serverUrl: this.serverUrl,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

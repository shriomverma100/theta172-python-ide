/**
 * THETA172 — Collab Relay Client
 * Connects to the cloud relay server from the renderer process.
 *
 * Works in two modes:
 *   HOST:   Teacher creates a room on the relay, all outgoing
 *           collab messages are forwarded through it.
 *   VIEWER: Student joins a room on the relay, receives
 *           forwarded messages from the teacher.
 *
 * The relay is protocol-transparent — all existing collab
 * messages pass through unchanged. The relay only knows about
 * room management (create/join/leave).
 */

import {
  MSG,
  createMessage, parseMessage,
  HEARTBEAT_INTERVAL,
} from './collab-protocol.js';

import '../styles/collab-relay.css';


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Max reconnect attempts before giving up */
const MAX_RECONNECT = 10;

/** Base reconnect delay (ms) */
const RECONNECT_BASE = 1000;

/** Relay message types */
const RELAY = {
  CREATE:   'relay_create',
  JOIN:     'relay_join',
  LEAVE:    'relay_leave',
  CREATED:  'relay_created',
  JOINED:   'relay_joined',
  ERROR:    'relay_error',
  FORWARD:  'relay_forward',
};

/** Default relay URL — hardcoded to the public THETA172 relay */
const DEFAULT_RELAY_URL = 'wss://theta172-relay.onrender.com';

/** LocalStorage key for saved relay URL */
const RELAY_URL_KEY = 'theta172_relay_url';


// ══════════════════════════════════════════════════════════════════
// SVG ICONS
// ══════════════════════════════════════════════════════════════════

export const CLOUD_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg>`;

export const LAN_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;


import { IConnection } from './IConnection.js';

// ══════════════════════════════════════════════════════════════════
// COLLAB RELAY CLASS
// ══════════════════════════════════════════════════════════════════

export class CollabRelay extends IConnection {
  constructor() {
    super();
    /** @type {WebSocket | null} */
    this.ws = null;

    /** @type {string} */
    this.relayUrl = getSavedRelayUrl();

    /** @type {'host' | 'viewer' | null} */
    this.role = null;

    /** @type {string} */
    this.roomKey = '';

    /** @type {string} */
    this.userName = '';

    /** @type {string} */
    this.clientId = '';

    /** @type {'disconnected' | 'connecting' | 'connected'} */
    this.status = 'disconnected';

    /** @type {boolean} */
    this._destroyed = false;

    /** @type {number} */
    this._reconnectAttempts = 0;

    /** @type {number | null} */
    this._reconnectTimer = null;

    /** @type {number | null} */
    this._heartbeatTimer = null;

    /** @type {boolean} */
    this._intentionalDisconnect = false;

    // ── Callbacks ──
    /** @type {Function | null} - Relay connected + room ready */
    this.onRelayConnected = null;

    /** @type {Function | null} - Relay disconnected */
    this.onRelayDisconnected = null;

    /** @type {Function | null} - Relay error */
    this.onRelayError = null;

    /** @type {Function | null} - Message received from relay (forwarded) */
    this.onMessageReceived = null;

    /** @type {Function | null} - Viewer joined (host only) */
    this.onViewerJoined = null;

    /** @type {Function | null} - Viewer left (host only) */
    this.onViewerLeft = null;
  }


  // ── HOST MODE ────────────────────────────────────────────────

  /**
   * Connect as host (teacher) and create a room.
   * @param {Object} options
   * @param {string} options.relayUrl  - Relay server URL
   * @param {string} options.roomKey   - Room key
   * @param {string} options.hostName  - Teacher's display name
   * @returns {Promise<void>}
   */
  connectAsHost(options) {
    return new Promise((resolve, reject) => {
      if (this._destroyed) {
        reject(new Error('Relay has been destroyed'));
        return;
      }

      this.role = 'host';
      this.relayUrl = options.relayUrl || this.relayUrl;
      this.roomKey = options.roomKey;
      this.userName = options.hostName || 'Host';
      this._intentionalDisconnect = false;
      this._reconnectAttempts = 0;

      saveRelayUrl(this.relayUrl);

      this._connect(resolve, reject, () => {
        // On open, create the room
        this._send({
          type: RELAY.CREATE,
          payload: {
            roomKey: this.roomKey,
            hostName: this.userName,
          },
        });
      });
    });
  }


  // ── VIEWER MODE ──────────────────────────────────────────────

  /**
   * Connect as viewer (student) and join a room.
   * @param {Object} options
   * @param {string} options.relayUrl  - Relay server URL
   * @param {string} options.roomKey   - Room key to join
   * @param {string} options.name      - Student's display name
   * @param {string} [options.clientId] - Client ID
   * @returns {Promise<void>}
   */
  connectAsViewer(options) {
    return new Promise((resolve, reject) => {
      if (this._destroyed) {
        reject(new Error('Relay has been destroyed'));
        return;
      }

      this.role = 'viewer';
      this.relayUrl = options.relayUrl || this.relayUrl;
      this.roomKey = options.roomKey;
      this.userName = options.name || 'Viewer';
      this.clientId = options.clientId || this._generateId();
      this._intentionalDisconnect = false;
      this._reconnectAttempts = 0;

      saveRelayUrl(this.relayUrl);

      this._connect(resolve, reject, () => {
        // On open, join the room
        this._send({
          type: RELAY.JOIN,
          payload: {
            roomKey: this.roomKey,
            name: this.userName,
            clientId: this.clientId,
          },
        });
      });
    });
  }


  // ── SEND ─────────────────────────────────────────────────────

  /**
   * Send a collab message through the relay.
   * The relay forwards it to all room members.
   * @param {Object} msg - Raw protocol message object
   */
  sendMessage(msg) {
    if (this.status !== 'connected' || !this.ws) return;
    this._send(msg);
  }

  /**
   * Send a raw string through the relay.
   * @param {string} raw
   */
  sendRaw(raw) {
    if (this.status !== 'connected' || !this.ws) return;
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(raw);
      }
    } catch (err) {
      console.warn('[RELAY] Send error:', err.message);
    }
  }


  // ── DISCONNECT ───────────────────────────────────────────────

  /**
   * Disconnect from the relay.
   */
  disconnect() {
    this._intentionalDisconnect = true;
    this._clearTimers();

    if (this.ws) {
      try {
        this._send({ type: RELAY.LEAVE, payload: {} });
        this.ws.close(1000, 'User disconnected');
      } catch (_) {}
      this.ws = null;
    }

    this.status = 'disconnected';
  }

  /**
   * Destroy the relay client entirely.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.disconnect();
    this.onRelayConnected = null;
    this.onRelayDisconnected = null;
    this.onRelayError = null;
    this.onMessageReceived = null;
    this.onViewerJoined = null;
    this.onViewerLeft = null;
    console.log('[RELAY] Destroyed');
  }


  // ── INTERNAL: CONNECTION ─────────────────────────────────────

  /**
   * Establish WebSocket connection to relay.
   */
  _connect(resolve, reject, onOpenAction) {
    this.status = 'connecting';

    try {
      this.ws = new WebSocket(this.relayUrl);
    } catch (err) {
      this.status = 'disconnected';
      reject(new Error(`Failed to connect to relay: ${err.message}`));
      return;
    }

    // Timeout
    const timeout = setTimeout(() => {
      if (this.status === 'connecting') {
        this.ws?.close();
        this.status = 'disconnected';
        reject(new Error('Relay connection timeout'));
      }
    }, 10000);

    this.ws.onopen = () => {
      clearTimeout(timeout);
      console.log('[RELAY] Connected to', this.relayUrl);

      // Run the role-specific open action (create or join)
      onOpenAction();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg || !msg.type) return;

        switch (msg.type) {
          case RELAY.CREATED:
            // Room created successfully (host mode)
            this.status = 'connected';
            this._startHeartbeat();
            this._reconnectAttempts = 0;
            if (this.onRelayConnected) {
              this.onRelayConnected({
                roomKey: msg.payload.roomKey,
                hostName: msg.payload.hostName,
                mode: 'cloud',
              });
            }
            resolve();
            break;

          case RELAY.JOINED:
            // Room joined successfully (viewer mode)
            this.status = 'connected';
            this._startHeartbeat();
            this._reconnectAttempts = 0;
            if (this.onRelayConnected) {
              this.onRelayConnected({
                roomKey: msg.payload.roomKey,
                hostName: msg.payload.hostName,
                clientId: msg.payload.clientId,
                viewerCount: msg.payload.viewerCount,
                mode: 'cloud',
              });
            }
            resolve();
            break;

          case RELAY.ERROR:
            console.error('[RELAY] Error:', msg.payload?.reason);
            if (this.status === 'connecting') {
              clearTimeout(timeout);
              reject(new Error(msg.payload?.reason || 'Relay error'));
            }
            if (this.onRelayError) {
              this.onRelayError(msg.payload?.reason || 'Unknown relay error');
            }
            break;

          default:
            // All other messages are forwarded collab protocol messages
            if (this.onMessageReceived) {
              this.onMessageReceived(msg);
            }
            break;
        }
      } catch (err) {
        console.warn('[RELAY] Message parse error:', err.message);
      }
    };

    this.ws.onclose = (event) => {
      clearTimeout(timeout);
      this._clearTimers();

      const wasConnected = this.status === 'connected';
      this.status = 'disconnected';

      if (wasConnected && !this._intentionalDisconnect && !this._destroyed) {
        console.log('[RELAY] Connection lost, will attempt reconnect');
        if (this.onRelayDisconnected) {
          this.onRelayDisconnected({ intentional: false, code: event.code });
        }
        this._attemptReconnect();
      } else if (wasConnected) {
        if (this.onRelayDisconnected) {
          this.onRelayDisconnected({ intentional: true, code: event.code });
        }
      }
    };

    this.ws.onerror = (err) => {
      console.warn('[RELAY] WebSocket error');
    };
  }


  // ── RECONNECT ────────────────────────────────────────────────

  _attemptReconnect() {
    if (this._destroyed || this._intentionalDisconnect) return;
    if (this._reconnectAttempts >= MAX_RECONNECT) {
      console.log('[RELAY] Max reconnect attempts reached');
      if (this.onRelayError) {
        this.onRelayError('Lost connection to relay. Max reconnection attempts reached.');
      }
      return;
    }

    this._reconnectAttempts++;
    const delay = RECONNECT_BASE * Math.pow(1.5, this._reconnectAttempts - 1);

    console.log(`[RELAY] Reconnect attempt ${this._reconnectAttempts}/${MAX_RECONNECT} in ${delay}ms`);

    this._reconnectTimer = setTimeout(() => {
      if (this._destroyed || this._intentionalDisconnect) return;

      const onOpenAction = this.role === 'host'
        ? () => {
            this._send({
              type: RELAY.CREATE,
              payload: { roomKey: this.roomKey, hostName: this.userName },
            });
          }
        : () => {
            this._send({
              type: RELAY.JOIN,
              payload: { roomKey: this.roomKey, name: this.userName, clientId: this.clientId },
            });
          };

      this._connect(
        () => {}, // resolve (no-op on reconnect)
        () => {
          // reject — try again
          this._attemptReconnect();
        },
        onOpenAction
      );
    }, delay);
  }


  // ── HEARTBEAT ────────────────────────────────────────────────

  _startHeartbeat() {
    this._clearTimers();
    this._heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this._send({ type: 'ping', payload: { ts: Date.now() } });
      }
    }, HEARTBEAT_INTERVAL);
  }


  // ── UTILS ────────────────────────────────────────────────────

  _send(msg) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    } catch (err) {
      console.warn('[RELAY] Send failed:', err.message);
    }
  }

  _clearTimers() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _generateId() {
    const chars = 'abcdef0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }
}


// ══════════════════════════════════════════════════════════════════
// RELAY URL PERSISTENCE
// ══════════════════════════════════════════════════════════════════

/**
 * Get saved relay URL from localStorage.
 * @returns {string}
 */
export function getSavedRelayUrl() {
  try {
    return localStorage.getItem(RELAY_URL_KEY) || DEFAULT_RELAY_URL;
  } catch (_) {
    return DEFAULT_RELAY_URL;
  }
}

/**
 * Save relay URL to localStorage.
 * @param {string} url
 */
export function saveRelayUrl(url) {
  try {
    localStorage.setItem(RELAY_URL_KEY, url);
  } catch (_) {}
}

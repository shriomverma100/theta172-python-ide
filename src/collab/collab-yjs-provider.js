/**
 * THETA172 — Collab Yjs Provider
 * Custom Yjs sync provider that works over our existing WebSocket protocol.
 *
 * Instead of y-websocket's dedicated server, we encode Yjs sync/update
 * messages as base64 strings inside our protocol's CRDT_SYNC message type.
 * The collab server relays these as opaque payloads.
 *
 * Features:
 *   - Y.Doc with shared Y.Text for code
 *   - Awareness for remote cursors/selections
 *   - Base64 encoding for WebSocket text transport
 *   - Sync handshake (step1/step2) on new peer connect
 *   - Incremental updates broadcast
 *   - Teacher (IPC) and Student (WS) transport abstraction
 */

import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Sync message types (matching y-protocols) */
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/** Remote cursor color palette (8 high-contrast colors) */
export const CURSOR_COLORS = [
  { color: '#00D4FF', light: '#00D4FF33', name: 'Cyan' },
  { color: '#FF3399', light: '#FF339933', name: 'Magenta' },
  { color: '#FFD600', light: '#FFD60033', name: 'Yellow' },
  { color: '#00E676', light: '#00E67633', name: 'Green' },
  { color: '#FF6D00', light: '#FF6D0033', name: 'Orange' },
  { color: '#AA00FF', light: '#AA00FF33', name: 'Purple' },
  { color: '#76FF03', light: '#76FF0333', name: 'Lime' },
  { color: '#FF1744', light: '#FF174433', name: 'Red' },
];


// ══════════════════════════════════════════════════════════════════
// YJS PROVIDER
// ══════════════════════════════════════════════════════════════════

export class CollabYjsProvider {
  /**
   * @param {Object} options
   * @param {string} options.userName - Display name for awareness
   * @param {boolean} options.isTeacher - Whether this is the teacher (host)
   * @param {Function} options.sendSync - Send CRDT sync data over network
   * @param {Function} options.sendAwareness - Send awareness data over network
   * @param {string} [options.initialCode] - Initial code (teacher only, when creating)
   * @param {number} [options.clientId] - Client ID for awareness color assignment
   */
  constructor(options) {
    /** @type {Y.Doc} */
    this.doc = new Y.Doc();

    /** @type {Y.Text} */
    this.ytext = this.doc.getText('code');

    /** @type {Awareness} */
    this.awareness = new Awareness(this.doc);

    /** @type {boolean} */
    this._isTeacher = options.isTeacher || false;

    /** @type {Function} */
    this._sendSync = options.sendSync;

    /** @type {Function} */
    this._sendAwareness = options.sendAwareness;

    /** @type {boolean} */
    this._destroyed = false;

    /** @type {boolean} */
    this._synced = false;

    // Pick a color based on clientId hash
    const colorIndex = (options.clientId || Math.random() * 1000) % CURSOR_COLORS.length;
    const cursorColor = CURSOR_COLORS[Math.floor(colorIndex)];

    // Set local awareness state
    this.awareness.setLocalStateField('user', {
      name: options.userName || 'User',
      color: cursorColor.color,
      colorLight: cursorColor.light,
      isTeacher: this._isTeacher,
    });

    // ── Initialize code (teacher only) ──
    if (this._isTeacher && options.initialCode) {
      this.doc.transact(() => {
        this.ytext.insert(0, options.initialCode);
      });
      this._synced = true;
    }

    // ── Listen for document updates ──
    this._onUpdate = (update, origin) => {
      if (this._destroyed) return;
      if (origin === 'remote') return; // Don't echo remote updates

      // Encode as sync update message
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const encoded = encoding.toUint8Array(encoder);

      this._sendEncoded(encoded, false);
    };
    this.doc.on('update', this._onUpdate);

    // ── Listen for awareness changes ──
    this._onAwarenessUpdate = ({ added, updated, removed }) => {
      if (this._destroyed) return;

      const changedClients = added.concat(updated).concat(removed);
      const encodedAwareness = encodeAwarenessUpdate(this.awareness, changedClients);

      this._sendEncoded(encodedAwareness, true);
    };
    this.awareness.on('update', this._onAwarenessUpdate);
  }


  // ── RECEIVE FROM NETWORK ─────────────────────────────────────

  /**
   * Handle incoming CRDT sync data from the network.
   * @param {Object} data - { encoded: string (base64) }
   */
  handleSyncMessage(data) {
    if (this._destroyed || !data || !data.encoded) return;

    try {
      const uint8 = this._base64ToUint8(data.encoded);
      const decoder = decoding.createDecoder(uint8);
      const msgType = decoding.readVarUint(decoder);

      switch (msgType) {
        case MSG_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          const syncType = syncProtocol.readSyncMessage(
            decoder, encoder, this.doc, 'remote'
          );

          // If we generated a response (sync step 2), send it
          if (encoding.length(encoder) > 1) {
            this._sendEncoded(encoding.toUint8Array(encoder), false);
          }

          if (syncType === 0) {
            // Received sync step 1 — we already sent step 2 above
          }
          if (!this._synced) {
            this._synced = true;
          }
          break;
        }

        default:
          console.warn('[YJS-PROVIDER] Unknown sync message type:', msgType);
      }
    } catch (err) {
      console.error('[YJS-PROVIDER] Error handling sync message:', err.message);
    }
  }

  /**
   * Handle incoming awareness data from the network.
   * @param {Object} data - { encoded: string (base64) }
   */
  handleAwarenessMessage(data) {
    if (this._destroyed || !data || !data.encoded) return;

    try {
      const uint8 = this._base64ToUint8(data.encoded);
      applyAwarenessUpdate(this.awareness, uint8, 'remote');
    } catch (err) {
      console.error('[YJS-PROVIDER] Error handling awareness:', err.message);
    }
  }


  // ── INITIATE SYNC (teacher sends state to new peer) ──────────

  /**
   * Send sync step 1 to request state from peers.
   * Called when a new peer connects (student side).
   */
  requestSync() {
    if (this._destroyed) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this._sendEncoded(encoding.toUint8Array(encoder), false);

    // Also broadcast current awareness
    const awarenessEncoded = encodeAwarenessUpdate(
      this.awareness,
      [this.doc.clientID]
    );
    this._sendEncoded(awarenessEncoded, true);
  }

  /**
   * Send full document state to peers.
   * Called when teacher starts collab mode (pushes full state).
   */
  broadcastFullState() {
    if (this._destroyed) return;

    // Send sync step 1 (contains full state vector)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this._sendEncoded(encoding.toUint8Array(encoder), false);

    // Send sync step 2 (contains full document as update)
    const encoder2 = encoding.createEncoder();
    encoding.writeVarUint(encoder2, MSG_SYNC);
    syncProtocol.writeSyncStep2(encoder2, this.doc);
    this._sendEncoded(encoding.toUint8Array(encoder2), false);

    // Broadcast awareness
    const awarenessEncoded = encodeAwarenessUpdate(
      this.awareness,
      [this.doc.clientID]
    );
    this._sendEncoded(awarenessEncoded, true);
  }


  // ── GET CURRENT CODE ─────────────────────────────────────────

  /**
   * Get the current code from the CRDT document.
   * @returns {string}
   */
  getCode() {
    return this.ytext.toString();
  }


  // ── DESTROY ──────────────────────────────────────────────────

  /**
   * Destroy the provider and cleanup.
   */
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;

    this.doc.off('update', this._onUpdate);
    this.awareness.off('update', this._onAwarenessUpdate);

    // Remove local awareness state
    this.awareness.setLocalState(null);

    this.awareness.destroy();
    this.doc.destroy();

    console.log('[YJS-PROVIDER] Destroyed');
  }


  // ── INTERNAL ─────────────────────────────────────────────────

  /**
   * Encode and send data over the network transport.
   * @param {Uint8Array} uint8 - Raw bytes
   * @param {boolean} isAwareness - Whether this is an awareness message
   */
  _sendEncoded(uint8, isAwareness) {
    if (this._destroyed) return;

    const base64 = this._uint8ToBase64(uint8);
    const payload = { encoded: base64 };

    try {
      if (isAwareness) {
        this._sendAwareness(payload);
      } else {
        this._sendSync(payload);
      }
    } catch (err) {
      console.warn('[YJS-PROVIDER] Send failed:', err.message);
    }
  }

  /**
   * Convert Uint8Array to base64 string.
   * @param {Uint8Array} uint8
   * @returns {string}
   */
  _uint8ToBase64(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array.
   * @param {string} base64
   * @returns {Uint8Array}
   */
  _base64ToUint8(base64) {
    const binary = atob(base64);
    const uint8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      uint8[i] = binary.charCodeAt(i);
    }
    return uint8;
  }
}

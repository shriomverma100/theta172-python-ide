/**
 * THETA172 — Collab Message Protocol
 * Defines all message types, payloads, and validation
 * for the WebSocket collab system.
 *
 * Protocol version: 1.0
 * Encoding: JSON over WebSocket text frames
 *
 * Every message has the shape:
 *   { type: string, payload: object, ts: number, sender: string }
 */


// ══════════════════════════════════════════════════════════════════
// MESSAGE TYPES
// ══════════════════════════════════════════════════════════════════

/**
 * All valid message types in the collab protocol.
 * Grouped by flow direction:
 *
 *   CLIENT → SERVER (viewer sends to sharer's server):
 *     JOIN, LEAVE, HIGHLIGHT_REQUEST, PING
 *
 *   SERVER → CLIENT (sharer's server sends to viewers):
 *     WELCOME, PEER_JOINED, PEER_LEFT, STATE_UPDATE,
 *     STATE_FULL, HIGHLIGHT, PONG, ERROR, ROOM_CLOSED
 *
 *   BIDIRECTIONAL:
 *     HEARTBEAT
 */
export const MSG = Object.freeze({
  // ── Connection Lifecycle ──
  JOIN:            'join',            // Viewer requests to join a room
  WELCOME:         'welcome',         // Server accepts join, sends initial state
  PEER_JOINED:     'peer_joined',     // A new viewer connected (broadcast to all)
  PEER_LEFT:       'peer_left',       // A viewer disconnected (broadcast to all)
  LEAVE:           'leave',           // Viewer explicitly disconnects
  ROOM_CLOSED:     'room_closed',     // Sharer stopped sharing (sent to all viewers)

  // ── State Synchronization ──
  STATE_FULL:      'state_full',      // Full IDE state snapshot (sent on join)
  STATE_UPDATE:    'state_update',    // Incremental state delta (code changed, cursor moved, etc.)

  // ── Interaction ──
  HIGHLIGHT:       'highlight',       // Teacher highlights a line on student's screen
  HIGHLIGHT_REQ:   'highlight_req',   // Viewer requests a highlight (viewer → server)

  // ── Health ──
  HEARTBEAT:       'heartbeat',       // Keep-alive ping/pong
  PING:            'ping',            // Client ping
  PONG:            'pong',            // Server pong

  // ── Error ──
  ERROR:           'error',           // Server-side error notification

  // ── Student State + Interactions ──
  STUDENT_STATE:   'student_state',   // Student sends their IDE state to teacher
  INTERACTION:     'interaction',     // Any interaction (highlight, hand, annotation, etc.)

  // ── Chat ──
  CHAT:            'chat',            // Text chat message (text, typing indicator)

  // ── CRDT Collaborative Editing ──
  CRDT_SYNC:       'crdt_sync',       // Yjs sync/update message (base64 binary)
  CRDT_AWARENESS:  'crdt_awareness',  // Yjs awareness update (cursor positions)
  COLLAB_MODE:     'collab_mode',     // Teacher toggles collaborative editing on/off

  // ── Cloud Relay ──
  RELAY_CREATE:    'relay_create',    // Host creates a room on the relay
  RELAY_JOIN:      'relay_join',      // Viewer joins a room on the relay
  RELAY_LEAVE:     'relay_leave',     // Participant leaves the relay room
  RELAY_CREATED:   'relay_created',   // Relay confirms room creation
  RELAY_JOINED:    'relay_joined',    // Relay confirms viewer joined
  RELAY_ERROR:     'relay_error',     // Relay error message
  RELAY_FORWARD:   'relay_forward',   // Relay-wrapped forwarded message
});


// ══════════════════════════════════════════════════════════════════
// PAYLOAD SCHEMAS
// ══════════════════════════════════════════════════════════════════

/**
 * Join payload — sent by viewer when connecting.
 * @typedef {Object} JoinPayload
 * @property {string} roomKey    - The room key to join (e.g., "T72-K9X")
 * @property {string} name       - The viewer's device/user name
 * @property {string} clientId   - Unique client identifier
 */

/**
 * Welcome payload — sent by server after successful join.
 * @typedef {Object} WelcomePayload
 * @property {string}   roomKey     - The room key
 * @property {string}   hostName    - The sharer's name
 * @property {string}   hostId      - The sharer's ID
 * @property {number}   viewerCount - Current number of viewers
 * @property {string[]} viewers     - Names of all connected viewers
 */

/**
 * Full IDE state — sent to new viewer on join.
 * @typedef {Object} StateFullPayload
 * @property {string}  code         - Full editor content
 * @property {Object}  cursor       - { line: number, col: number }
 * @property {Object}  selection    - { startLine, startCol, endLine, endCol } | null
 * @property {string}  terminal     - Last N lines of terminal output
 * @property {string}  fileName     - Active file name
 * @property {string}  theme        - 'dark' | 'light'
 * @property {boolean} isRunning    - Whether code is currently executing
 * @property {number}  fontSize     - Editor font size in px
 * @property {Array}   errors       - Array of { line, message }
 * @property {Array}   tabs         - Array of { name, active }
 */

/**
 * State delta — sent whenever something changes.
 * Only includes fields that changed (sparse update).
 * @typedef {Object} StateUpdatePayload
 * @property {string}  [code]       - New editor content (if changed)
 * @property {Object}  [cursor]     - New cursor position (if moved)
 * @property {Object}  [selection]  - New selection (if changed)
 * @property {string}  [terminalAppend] - New terminal output to append
 * @property {boolean} [isRunning]  - Run state changed
 * @property {Array}   [errors]     - Error list changed
 * @property {string}  [fileName]   - Active file changed
 * @property {Array}   [tabs]       - Tab list changed
 */

/**
 * Highlight payload — teacher highlights a line.
 * @typedef {Object} HighlightPayload
 * @property {number}  line         - Line number to highlight (1-based)
 * @property {string}  viewerName   - Who sent the highlight
 * @property {string}  color        - Highlight color (default: #FF3300)
 * @property {number}  duration     - How long to show in ms (default: 5000)
 */

/**
 * Error payload — server error notification.
 * @typedef {Object} ErrorPayload
 * @property {string}  code         - Error code (e.g., 'ROOM_NOT_FOUND', 'ROOM_FULL')
 * @property {string}  message      - Human-readable error message
 */


// ══════════════════════════════════════════════════════════════════
// ERROR CODES
// ══════════════════════════════════════════════════════════════════

export const ERR = Object.freeze({
  ROOM_NOT_FOUND:  'ROOM_NOT_FOUND',
  ROOM_FULL:       'ROOM_FULL',
  INVALID_KEY:     'INVALID_KEY',
  INVALID_MSG:     'INVALID_MSG',
  AUTH_FAILED:     'AUTH_FAILED',
  SERVER_ERROR:    'SERVER_ERROR',
  CONNECTION_LOST: 'CONNECTION_LOST',
});


// ══════════════════════════════════════════════════════════════════
// MESSAGE FACTORY
// ══════════════════════════════════════════════════════════════════

/**
 * Create a properly formatted protocol message.
 * @param {string} type    - Message type from MSG enum
 * @param {Object} payload - Message payload
 * @param {string} sender  - Sender ID
 * @returns {string} JSON string ready to send over WebSocket
 */
export function createMessage(type, payload, sender) {
  const msg = {
    type,
    payload: payload || {},
    ts: Date.now(),
    sender: sender || '',
    v: 1, // Protocol version
  };
  return JSON.stringify(msg);
}


/**
 * Parse an incoming WebSocket message.
 * Returns null if the message is invalid.
 * @param {string} raw - Raw WebSocket message data
 * @returns {{ type: string, payload: Object, ts: number, sender: string } | null}
 */
export function parseMessage(raw) {
  try {
    if (typeof raw !== 'string') {
      raw = raw.toString('utf8');
    }

    const msg = JSON.parse(raw);

    // Validate required fields
    if (!msg || typeof msg.type !== 'string') {
      return null;
    }

    // Validate message type is known
    const validTypes = Object.values(MSG);
    if (!validTypes.includes(msg.type)) {
      return null;
    }

    return {
      type: msg.type,
      payload: msg.payload || {},
      ts: msg.ts || Date.now(),
      sender: msg.sender || '',
      v: msg.v || 1,
    };
  } catch (_) {
    return null;
  }
}


// ══════════════════════════════════════════════════════════════════
// VALIDATION
// ══════════════════════════════════════════════════════════════════

/**
 * Validate a room key format.
 * Format: T72-XXX where X is [A-Z0-9] excluding ambiguous chars.
 * @param {string} key
 * @returns {boolean}
 */
export function isValidRoomKey(key) {
  if (!key || typeof key !== 'string') return false;
  return /^T72-[A-HJ-NP-Z2-9]{3}$/.test(key.toUpperCase());
}


/**
 * Validate a join payload.
 * @param {Object} payload
 * @returns {boolean}
 */
export function isValidJoinPayload(payload) {
  if (!payload) return false;
  if (!payload.roomKey || !isValidRoomKey(payload.roomKey)) return false;
  if (!payload.name || typeof payload.name !== 'string') return false;
  if (!payload.clientId || typeof payload.clientId !== 'string') return false;
  if (payload.name.length > 64) return false;
  if (payload.clientId.length > 128) return false;
  return true;
}


/**
 * Validate a state update payload (sparse — all fields optional).
 * @param {Object} payload
 * @returns {boolean}
 */
export function isValidStatePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  // Code must be string if present
  if (payload.code !== undefined && typeof payload.code !== 'string') return false;
  // Cursor must be object with line/col if present
  if (payload.cursor !== undefined) {
    if (typeof payload.cursor !== 'object') return false;
    if (typeof payload.cursor.line !== 'number') return false;
    if (typeof payload.cursor.col !== 'number') return false;
  }
  return true;
}


// ══════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════

/** Maximum viewers per room */
export const MAX_VIEWERS = 5;

/** Heartbeat interval in ms */
export const HEARTBEAT_INTERVAL = 15000;

/** Heartbeat timeout — if no response in this time, disconnect */
export const HEARTBEAT_TIMEOUT = 45000;

/** Maximum code size to sync (prevent abuse) — 500KB */
export const MAX_CODE_SIZE = 512 * 1024;

/** Maximum terminal buffer to sync — 50KB */
export const MAX_TERMINAL_SIZE = 50 * 1024;

/** State update debounce interval in ms */
export const STATE_DEBOUNCE = 100;

/** Default highlight duration in ms */
export const HIGHLIGHT_DURATION = 5000;

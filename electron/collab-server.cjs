/**
 * THETA172 — Collab WebSocket Server
 * Runs inside Electron main process (Node.js).
 * Uses CommonJS (require) because Electron main is CJS.
 *
 * The sharer's machine hosts this server.
 * Viewers connect as WebSocket clients.
 *
 * Features:
 *   - Random port allocation (OS assigns)
 *   - Room key validation
 *   - Max 5 viewers per room
 *   - Heartbeat keep-alive
 *   - Clean disconnect handling
 *   - Message broadcasting
 */

const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');
const { CollabSecurity } = require('./collab-security.cjs');

// ── FIREWALL HELPERS (Windows) ─────────────────────────────────
const FIREWALL_RULE_NAME = 'THETA172-Collab-Server';

function addFirewallRule(port) {
  if (process.platform !== 'win32') return;
  try {
    // Remove old rule first (if exists)
    try {
      execSync(`netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}"`, { stdio: 'ignore' });
    } catch (_) {}
    // Add new inbound rule allowing TCP on the specific port
    execSync(
      `netsh advfirewall firewall add rule name="${FIREWALL_RULE_NAME}" dir=in action=allow protocol=TCP localport=${port}`,
      { stdio: 'ignore' }
    );
    console.log(`[COLLAB] Firewall rule added for port ${port}`);
  } catch (err) {
    console.warn(`[COLLAB] Could not add firewall rule (may need admin): ${err.message}`);
  }
}

function removeFirewallRule() {
  if (process.platform !== 'win32') return;
  try {
    execSync(`netsh advfirewall firewall delete rule name="${FIREWALL_RULE_NAME}"`, { stdio: 'ignore' });
    console.log('[COLLAB] Firewall rule removed');
  } catch (_) {}
}


// ══════════════════════════════════════════════════════════════════
// PROTOCOL CONSTANTS (mirrored from collab-protocol.js for CJS)
// ══════════════════════════════════════════════════════════════════

const MSG = {
  JOIN:            'join',
  WELCOME:         'welcome',
  PEER_JOINED:     'peer_joined',
  PEER_LEFT:       'peer_left',
  LEAVE:           'leave',
  ROOM_CLOSED:     'room_closed',
  STATE_FULL:      'state_full',
  STATE_UPDATE:    'state_update',
  HIGHLIGHT:       'highlight',
  HIGHLIGHT_REQ:   'highlight_req',
  HEARTBEAT:       'heartbeat',
  PING:            'ping',
  PONG:            'pong',
  ERROR:           'error',
  STUDENT_STATE:   'student_state',
  INTERACTION:     'interaction',
  CHAT:            'chat',
  CRDT_SYNC:       'crdt_sync',
  CRDT_AWARENESS:  'crdt_awareness',
  COLLAB_MODE:     'collab_mode',
};

const ERR = {
  ROOM_NOT_FOUND:  'ROOM_NOT_FOUND',
  ROOM_FULL:       'ROOM_FULL',
  INVALID_KEY:     'INVALID_KEY',
  INVALID_MSG:     'INVALID_MSG',
  AUTH_FAILED:     'AUTH_FAILED',
  SERVER_ERROR:    'SERVER_ERROR',
};

const MAX_VIEWERS = 5;
const HEARTBEAT_INTERVAL = 15000;
const HEARTBEAT_TIMEOUT = 45000;
const MAX_CODE_SIZE = 512 * 1024;


// ══════════════════════════════════════════════════════════════════
// SERVER CLASS
// ══════════════════════════════════════════════════════════════════

class CollabServer {
  constructor() {
    /** @type {import('ws').WebSocketServer | null} */
    this.wss = null;

    /** @type {number} */
    this.port = 0;

    /** @type {string} */
    this.roomKey = '';

    /** @type {string} */
    this.hostName = '';

    /** @type {string} */
    this.hostId = '';

    /** @type {Map<string, { ws: import('ws').WebSocket, name: string, id: string, lastPong: number }>} */
    this.viewers = new Map();

    /** @type {NodeJS.Timer | null} */
    this.heartbeatTimer = null;

    /** @type {Object | null} - Latest full IDE state from the sharer */
    this.currentState = null;

    /** @type {boolean} */
    this.running = false;

    /** @type {Function | null} - Callback when a viewer joins/leaves */
    this.onViewerChange = null;

    /** @type {Function | null} - Callback when a highlight is requested */
    this.onHighlightRequest = null;

    /** @type {Function | null} - Callback for server errors */
    this.onError = null;

    /** @type {Function | null} - Callback when a student sends their state */
    this.onStudentState = null;

    /** @type {Function | null} - Callback when a viewer sends an interaction */
    this.onInteraction = null;

    /** @type {CollabSecurity} - Security manager */
    this.security = new CollabSecurity();

    /** @type {Function | null} - Callback when a viewer sends a chat message */
    this.onChat = null;

    /** @type {Function | null} - Callback when a viewer sends a CRDT sync message */
    this.onCrdtSync = null;
  }


  // ── START SERVER ──────────────────────────────────────────────

  /**
   * Start the WebSocket server on a random available port.
   * @param {Object} options
   * @param {string} options.roomKey  - The room key for this session
   * @param {string} options.hostName - The sharer's display name
   * @param {string} options.hostId   - The sharer's unique ID
   * @returns {Promise<{ port: number, roomKey: string, addresses: string[] }>}
   */
  start(options) {
    return new Promise((resolve, reject) => {
      if (this.running) {
        reject(new Error('Server already running'));
        return;
      }

      this.roomKey = options.roomKey;
      this.hostName = options.hostName || 'Host';
      this.hostId = options.hostId || crypto.randomUUID();
      this.currentState = null;
      this.viewers.clear();

      // Set room password if provided
      if (options.password) {
        this.security.setRoomPassword(options.password);
      } else {
        this.security.setRoomPassword(null);
      }

      // Create WebSocket server on port 0 (OS assigns available port)
      // Bind to 0.0.0.0 explicitly to accept connections from ALL network interfaces
      this.wss = new WebSocketServer({
        port: 0,
        host: '0.0.0.0',
        maxPayload: MAX_CODE_SIZE * 2, // 1MB max message
        perMessageDeflate: {
          zlibDeflateOptions: { level: 3 },
          threshold: 256, // Only compress messages > 256 bytes
        },
      });

      this.wss.on('listening', () => {
        const addr = this.wss.address();
        this.port = addr.port;
        this.running = true;

        // Add Windows Firewall rule so other machines can connect
        addFirewallRule(this.port);

        // Start heartbeat checker
        this.startHeartbeat();

        const addresses = this.getLocalAddresses();

        console.log(`[COLLAB] Server started on 0.0.0.0:${this.port}, room: ${this.roomKey}`);
        console.log(`[COLLAB] Reachable at: ${addresses.map(a => a + ':' + this.port).join(', ')}`);

        resolve({
          port: this.port,
          roomKey: this.roomKey,
          addresses,
          hasPassword: this.security.hasPassword(),
        });
      });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      this.wss.on('error', (err) => {
        console.error('[COLLAB] Server error:', err.message);
        if (this.onError) this.onError(err.message);
        if (!this.running) {
          reject(err);
        }
      });
    });
  }


  // ── STOP SERVER ───────────────────────────────────────────────

  /**
   * Stop the WebSocket server and disconnect all viewers.
   */
  stop() {
    if (!this.running) return;

    console.log('[COLLAB] Stopping server...');

    // Remove firewall rule
    removeFirewallRule();

    // Notify all viewers that the room is closing
    this.broadcast(this.createMsg(MSG.ROOM_CLOSED, {
      reason: 'Host stopped sharing',
    }));

    // Close all viewer connections
    for (const [id, viewer] of this.viewers) {
      try {
        viewer.ws.close(1000, 'Room closed');
      } catch (_) {}
    }
    this.viewers.clear();

    // Stop heartbeat
    this.stopHeartbeat();

    // Close server
    if (this.wss) {
      try {
        this.wss.close();
      } catch (err) {
        console.warn(`[COLLAB] Error closing WSS: ${err.message}`);
      }
      this.wss = null;
    }

    this.running = false;
    this.port = 0;
    this.currentState = null;

    // Reset and destroy security state
    this.security.destroy();

    console.log('[COLLAB] Server stopped');
  }


  // ── CONNECTION HANDLER ────────────────────────────────────────

  /**
   * Handle a new WebSocket connection.
   * The viewer must send a JOIN message within 5 seconds.
   */
  handleConnection(ws, req) {
    const remoteAddr = req.socket.remoteAddress || 'unknown';
    console.log(`[COLLAB] New connection from ${remoteAddr}`);

    // ── Rate limit check ──
    const rateCheck = this.security.checkConnectionRate(remoteAddr);
    if (!rateCheck.allowed) {
      console.warn(`[COLLAB] Rate limited: ${remoteAddr} — ${rateCheck.reason}`);
      this.sendTo(ws, this.createMsg(MSG.ERROR, {
        code: ERR.AUTH_FAILED,
        message: rateCheck.reason,
      }));
      ws.close(4010, 'Rate limited');
      return;
    }

    // Set a timeout for the JOIN message
    let authenticated = false;
    let viewerId = null;

    const joinTimeout = setTimeout(() => {
      if (!authenticated) {
        console.log(`[COLLAB] Connection from ${remoteAddr} timed out (no JOIN)`);
        ws.close(4001, 'Join timeout');
      }
    }, 5000);

    ws.on('message', (data) => {
      // ── Message validation ──
      const validation = this.security.validateMessage(data);
      if (!validation.valid) {
        this.sendTo(ws, this.createMsg(MSG.ERROR, {
          code: ERR.INVALID_MSG,
          message: validation.reason,
        }));
        return;
      }

      const msg = this.parseMsg(data);
      if (!msg) {
        this.sendTo(ws, this.createMsg(MSG.ERROR, {
          code: ERR.INVALID_MSG,
          message: 'Invalid message format',
        }));
        return;
      }

      if (!authenticated) {
        // First message must be JOIN
        if (msg.type !== MSG.JOIN) {
          this.sendTo(ws, this.createMsg(MSG.ERROR, {
            code: ERR.AUTH_FAILED,
            message: 'First message must be JOIN',
          }));
          ws.close(4002, 'Auth failed');
          return;
        }

        // Validate join payload
        const { roomKey, name, clientId, password } = msg.payload;

        // Sanitize inputs
        const sanitizedKey = this.security.sanitizeRoomKey(roomKey);
        const sanitizedName = this.security.sanitizeName(name);

        if (!sanitizedKey || sanitizedKey !== this.roomKey) {
          this.security.recordFailedAttempt(remoteAddr);
          this.sendTo(ws, this.createMsg(MSG.ERROR, {
            code: ERR.INVALID_KEY,
            message: 'Invalid room key',
          }));
          ws.close(4003, 'Invalid key');
          return;
        }

        // ── Password check ──
        if (this.security.hasPassword()) {
          if (!this.security.verifyPassword(password || '')) {
            this.security.recordFailedAttempt(remoteAddr);
            this.sendTo(ws, this.createMsg(MSG.ERROR, {
              code: ERR.AUTH_FAILED,
              message: 'Incorrect room password',
            }));
            ws.close(4011, 'Wrong password');
            return;
          }
        }

        if (this.viewers.size >= MAX_VIEWERS) {
          this.sendTo(ws, this.createMsg(MSG.ERROR, {
            code: ERR.ROOM_FULL,
            message: `Room is full (max ${MAX_VIEWERS} viewers)`,
          }));
          ws.close(4004, 'Room full');
          return;
        }

        // Accept the viewer — clear any failed attempts
        this.security.clearFailedAttempts(remoteAddr);
        authenticated = true;
        clearTimeout(joinTimeout);

        viewerId = clientId || crypto.randomUUID();
        const viewerName = sanitizedName;

        this.viewers.set(viewerId, {
          ws,
          name: viewerName,
          id: viewerId,
          lastPong: Date.now(),
        });

        console.log(`[COLLAB] Viewer joined: ${viewerName} (${viewerId})`);

        // Send WELCOME
        this.sendTo(ws, this.createMsg(MSG.WELCOME, {
          roomKey: this.roomKey,
          hostName: this.hostName,
          hostId: this.hostId,
          viewerCount: this.viewers.size,
          viewers: Array.from(this.viewers.values()).map((v) => v.name),
        }));

        // Send current full state if available
        if (this.currentState) {
          this.sendTo(ws, this.createMsg(MSG.STATE_FULL, this.currentState));
        }

        // Broadcast to other viewers that a new peer joined
        this.broadcastExcept(viewerId, this.createMsg(MSG.PEER_JOINED, {
          name: viewerName,
          id: viewerId,
          viewerCount: this.viewers.size,
        }));

        // Notify the host (renderer)
        if (this.onViewerChange) {
          this.onViewerChange(this.getViewerList());
        }

        return;
      }

      // ── Authenticated viewer messages ──

      switch (msg.type) {
        case MSG.PING:
          this.sendTo(ws, this.createMsg(MSG.PONG, { ts: msg.ts }));
          break;

        case MSG.HEARTBEAT:
          if (viewerId && this.viewers.has(viewerId)) {
            this.viewers.get(viewerId).lastPong = Date.now();
          }
          this.sendTo(ws, this.createMsg(MSG.HEARTBEAT, { ts: Date.now() }));
          break;

        case MSG.HIGHLIGHT_REQ:
          // Forward highlight request to the host
          if (this.onHighlightRequest) {
            this.onHighlightRequest({
              line: msg.payload.line,
              viewerName: this.viewers.get(viewerId)?.name || 'Unknown',
              viewerId,
            });
          }
          break;

        case MSG.LEAVE:
          // Explicit disconnect
          this.removeViewer(viewerId, 'left');
          ws.close(1000, 'Goodbye');
          break;

        case MSG.STUDENT_STATE:
          // Forward student's IDE state to the teacher dashboard
          if (this.onStudentState) {
            this.onStudentState({
              viewerId: viewerId,
              viewerName: this.viewers.get(viewerId)?.name || 'Unknown',
              state: msg.payload || {},
            });
          }
          break;

        case MSG.INTERACTION:
          // Forward interaction to the teacher (host renderer) via IPC
          if (this.onInteraction) {
            this.onInteraction({
              viewerId: viewerId,
              viewerName: this.viewers.get(viewerId)?.name || 'Unknown',
              interactionType: msg.payload?.type || 'unknown',
              payload: msg.payload || {},
            });
          }
          // Broadcast to all other viewers so they see it too
          this.broadcastExcept(viewerId, this.createMsg(MSG.INTERACTION, {
            ...msg.payload,
            senderId: viewerId,
            senderName: this.viewers.get(viewerId)?.name || 'Unknown',
          }));
          break;

        case MSG.CHAT:
          // Forward chat to the teacher (host renderer) via IPC
          if (this.onChat) {
            this.onChat({
              viewerId: viewerId,
              viewerName: this.viewers.get(viewerId)?.name || 'Unknown',
              payload: msg.payload || {},
            });
          }
          // Broadcast to all other viewers
          this.broadcastExcept(viewerId, this.createMsg(MSG.CHAT, {
            ...msg.payload,
            senderId: viewerId,
            senderName: this.viewers.get(viewerId)?.name || 'Unknown',
          }));
          break;

        case MSG.CRDT_SYNC:
          // Relay CRDT sync to all other viewers
          this.broadcastExcept(viewerId, this.createMsg(MSG.CRDT_SYNC, msg.payload));
          // Forward to teacher (host) via IPC
          if (this.onCrdtSync) {
            this.onCrdtSync({ viewerId, payload: msg.payload });
          }
          break;

        case MSG.CRDT_AWARENESS:
          // Relay awareness to all other viewers
          this.broadcastExcept(viewerId, this.createMsg(MSG.CRDT_AWARENESS, msg.payload));
          // Forward to teacher
          if (this.onCrdtSync) {
            this.onCrdtSync({ viewerId, payload: msg.payload, isAwareness: true });
          }
          break;

        default:
          // Unknown message type from viewer — ignore
          break;
      }
    });

    ws.on('close', (code, reason) => {
      clearTimeout(joinTimeout);
      if (viewerId) {
        this.removeViewer(viewerId, 'disconnected');
      }
    });

    ws.on('error', (err) => {
      console.error(`[COLLAB] Viewer socket error: ${err.message}`);
      clearTimeout(joinTimeout);
      if (viewerId) {
        this.removeViewer(viewerId, 'error');
      }
    });
  }


  // ── VIEWER MANAGEMENT ─────────────────────────────────────────

  /**
   * Remove a viewer and notify others.
   */
  removeViewer(viewerId, reason) {
    const viewer = this.viewers.get(viewerId);
    if (!viewer) return;

    console.log(`[COLLAB] Viewer left: ${viewer.name} (${reason})`);

    this.viewers.delete(viewerId);

    // Broadcast to remaining viewers
    this.broadcast(this.createMsg(MSG.PEER_LEFT, {
      name: viewer.name,
      id: viewerId,
      reason,
      viewerCount: this.viewers.size,
    }));

    // Notify host
    if (this.onViewerChange) {
      this.onViewerChange(this.getViewerList());
    }
  }

  /**
   * Get a clean list of connected viewers.
   */
  getViewerList() {
    return Array.from(this.viewers.values()).map((v) => ({
      id: v.id,
      name: v.name,
    }));
  }


  // ── STATE BROADCASTING ────────────────────────────────────────

  /**
   * Update the current state and broadcast to all viewers.
   * Called by the host (renderer via IPC) when something changes.
   * @param {Object} fullState - Full IDE state snapshot
   */
  updateFullState(fullState) {
    this.currentState = fullState;
  }

  /**
   * Broadcast a state delta to all viewers.
   * @param {Object} delta - Only the fields that changed
   */
  broadcastStateDelta(delta) {
    if (!this.running || this.viewers.size === 0) return;
    this.broadcast(this.createMsg(MSG.STATE_UPDATE, delta));
  }

  /**
   * Broadcast a highlight to all viewers.
   * @param {Object} highlight - { line, viewerName, color, duration }
   */
  broadcastHighlight(highlight) {
    if (!this.running) return;
    this.broadcast(this.createMsg(MSG.HIGHLIGHT, highlight));
  }

  /**
   * Broadcast an interaction from the teacher to all viewers.
   * @param {Object} interaction - { type, payload, senderName, senderId }
   */
  broadcastInteraction(interaction) {
    if (!this.running) return;
    this.broadcast(this.createMsg(MSG.INTERACTION, interaction));
  }

  /**
   * Broadcast a chat message from the teacher to all viewers.
   * @param {Object} chatMsg - Chat payload
   */
  broadcastChat(chatMsg) {
    if (!this.running) return;
    this.broadcast(this.createMsg(MSG.CHAT, chatMsg));
  }

  /**
   * Broadcast a CRDT sync message from the teacher to all viewers.
   * @param {Object} crdtData - Encoded CRDT payload
   */
  broadcastCrdt(crdtData) {
    if (!this.running) return;
    this.broadcast(this.createMsg(MSG.CRDT_SYNC, crdtData));
  }

  /**
   * Broadcast a CRDT awareness update from the teacher to all viewers.
   * @param {Object} awarenessData - Encoded awareness payload
   */
  broadcastAwareness(awarenessData) {
    if (!this.running) return;
    this.broadcast(this.createMsg(MSG.CRDT_AWARENESS, awarenessData));
  }

  /**
   * Broadcast collab mode change to all viewers.
   * @param {Object} modeData - { enabled: boolean }
   */
  broadcastCollabMode(modeData) {
    if (!this.running) return;
    this.broadcast(this.createMsg(MSG.COLLAB_MODE, modeData));
  }


  // ── HEARTBEAT ─────────────────────────────────────────────────

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      for (const [id, viewer] of this.viewers) {
        if (now - viewer.lastPong > HEARTBEAT_TIMEOUT) {
          console.log(`[COLLAB] Viewer ${viewer.name} timed out`);
          try { viewer.ws.close(4005, 'Heartbeat timeout'); } catch (_) {}
          this.removeViewer(id, 'timeout');
          continue;
        }

        // Send heartbeat
        this.sendTo(viewer.ws, this.createMsg(MSG.HEARTBEAT, { ts: now }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }


  // ── MESSAGING HELPERS ─────────────────────────────────────────

  /**
   * Create a JSON message string.
   */
  createMsg(type, payload) {
    return JSON.stringify({
      type,
      payload: payload || {},
      ts: Date.now(),
      sender: this.hostId,
      v: 1,
    });
  }

  /**
   * Parse an incoming message.
   */
  parseMsg(raw) {
    try {
      const str = typeof raw === 'string' ? raw : raw.toString('utf8');
      const msg = JSON.parse(str);
      if (!msg || typeof msg.type !== 'string') return null;
      return msg;
    } catch (_) {
      return null;
    }
  }

  /**
   * Send a message to a specific WebSocket.
   */
  sendTo(ws, msgStr) {
    try {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(msgStr);
      }
    } catch (err) {
      console.error('[COLLAB] Send error:', err.message);
    }
  }

  /**
   * Broadcast a message to all connected viewers.
   */
  broadcast(msgStr) {
    for (const [, viewer] of this.viewers) {
      this.sendTo(viewer.ws, msgStr);
    }
  }

  /**
   * Broadcast a message to all viewers except one.
   */
  broadcastExcept(excludeId, msgStr) {
    for (const [id, viewer] of this.viewers) {
      if (id !== excludeId) {
        this.sendTo(viewer.ws, msgStr);
      }
    }
  }


  // ── NETWORK HELPERS ───────────────────────────────────────────

  /**
   * Get all local network addresses (IPv4, non-internal).
   */
  getLocalAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    // Virtual adapter keywords to deprioritize
    const VIRTUAL_KEYWORDS = ['vmware', 'virtualbox', 'veth', 'docker', 'wsl', 'vEthernet', 'vpn', 'tap', 'tun', 'loopback'];

    for (const name of Object.keys(interfaces)) {
      const isVirtual = VIRTUAL_KEYWORDS.some(kw => name.toLowerCase().includes(kw.toLowerCase()));
      for (const iface of interfaces[name]) {
        // Skip internal (loopback) and IPv6
        if (iface.internal || iface.family !== 'IPv4') continue;
        if (isVirtual) {
          // Add virtual adapters at the end
          addresses.push({ ip: iface.address, priority: 1 });
        } else {
          // Real adapters first
          addresses.push({ ip: iface.address, priority: 0 });
        }
      }
    }

    // Sort by priority (real adapters first), then return just the IPs
    addresses.sort((a, b) => a.priority - b.priority);
    return addresses.map(a => a.ip);
  }

  /**
   * Get server info for display / mDNS broadcast.
   */
  getServerInfo() {
    return {
      port: this.port,
      roomKey: this.roomKey,
      hostName: this.hostName,
      hostId: this.hostId,
      viewerCount: this.viewers.size,
      addresses: this.getLocalAddresses(),
      running: this.running,
    };
  }
}


// ── SINGLETON EXPORT ────────────────────────────────────────────

module.exports = { CollabServer };

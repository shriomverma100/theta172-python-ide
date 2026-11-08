/**
 * THETA172 — Classroom Discovery (Student Side)
 * UDP listener for teacher discovery + WebSocket client.
 * Runs inside Electron main process.
 */

const dgram = require('dgram');
const WebSocket = require('ws');
const net = require('net');
const { sanitizeLabel } = require('./validate.cjs');

const UDP_PORT = 41234;

class ClassroomDiscovery {
  constructor() {
    this.udpSocket = null;
    this.ws = null;
    this.studentName = '';
    this.studentRoll = '';
    this.connected = false;
    this.discovering = false;
    this.teacherInfo = null;

    // Callbacks
    this.onTeacherFound = null;
    this.onTeacherLost = null;
    this.onCodeSync = null;
    this.onCodeChange = null;
    this.onViewRequest = null;
    this.onEditRequest = null;
    this.onEditCode = null;
    this.onEditLive = null;
    this.onSessionEnd = null;
    this.onConnected = null;
    this.onDisconnected = null;
    this.onTerminal = null;
    this.onCursor = null;
    this.onSelection = null;
    this.onChatMessage = null;
  }

  /**
   * Start listening for teacher broadcasts
   */
  startDiscovery(name, roll) {
    if (this.discovering) return;

    this.studentName = name;
    this.studentRoll = roll;
    this.discovering = true;

    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.udpSocket.on('message', (buf) => {
        try {
          const msg = JSON.parse(buf.toString());
          if (msg.type === 'THETA_CLASSROOM' && !this.connected) {
            // Broadcasts are unauthenticated: accept only a plain IPv4
            // address and a valid port, and clean the display name.
            if (typeof msg.ip !== 'string' || !net.isIPv4(msg.ip)) return;
            if (!Number.isInteger(msg.wsPort) || msg.wsPort < 1 || msg.wsPort > 65535) return;
            this.teacherInfo = {
              teacher: sanitizeLabel(msg.teacher, 64, 'Teacher'),
              ip: msg.ip,
              wsPort: msg.wsPort,
            };
            if (this.onTeacherFound) {
              this.onTeacherFound(this.teacherInfo);
            }
            // Auto-connect
            this._connectToTeacher(msg.ip, msg.wsPort);
          }
        } catch (_) {}
      });

      this.udpSocket.on('error', (err) => {
        console.error('[CLASSROOM-DISC] UDP error:', err.message);
      });

      this.udpSocket.bind(UDP_PORT, '0.0.0.0');
    } catch (err) {
      console.error('[CLASSROOM-DISC] Failed to start discovery:', err.message);
    }
  }

  /**
   * Stop discovery and disconnect
   */
  stopDiscovery() {
    this.discovering = false;
    this.connected = false;
    this.teacherInfo = null;

    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }

    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch (_) {}
      this.udpSocket = null;
    }
  }

  /**
   * Send help request to teacher
   */
  sendHelpRequest(message) {
    this._send({ type: 'help-request', message });
  }

  /**
   * Send student's code to teacher (in response to view-request)
   */
  sendCode(code, fileName) {
    this._send({ type: 'student-code', code, fileName });
  }

  /**
   * Respond to edit permission request
   */
  grantEditPermission(granted) {
    this._send({ type: 'edit-grant', granted });
  }

  /**
   * Revoke previously granted edit permission
   */
  revokeEditPermission() {
    this._send({ type: 'edit-revoke' });
  }

  /**
   * Send live code updates to teacher (auto-stream)
   */
  sendCodeLive(code, fileName) {
    this._send({ type: 'student-code-live', code, fileName });
  }

  /**
   * Send terminal output to teacher (live stream)
   */
  sendOutputLive(text, stream) {
    this._send({ type: 'student-output', text, stream });
  }

  /**
   * Send a chat message to teacher or broadcast
   */
  sendChatMessage(text, target) {
    this._send({ type: 'chat-message', text, target });
  }

  // ── Internal ──

  _connectToTeacher(ip, port) {
    if (this.connected || this.ws) return;

    try {
      this.ws = new WebSocket(`ws://${ip}:${port}`, { maxPayload: 1024 * 1024, handshakeTimeout: 8000 });

      this.ws.on('open', () => {
        this.connected = true;

        // Send join message
        this._send({ type: 'join', name: this.studentName, roll: this.studentRoll });

        // Stop UDP listening (we're connected)
        if (this.udpSocket) {
          try { this.udpSocket.close(); } catch (_) {}
          this.udpSocket = null;
        }

        if (this.onConnected) {
          this.onConnected(this.teacherInfo);
        }
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this._handleMessage(msg);
        } catch (_) {}
      });

      this.ws.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;

        if (wasConnected && this.onDisconnected) {
          this.onDisconnected();
        }

        // Restart discovery if we were still discovering
        if (this.discovering) {
          setTimeout(() => {
            if (this.discovering && !this.connected) {
              this.startDiscovery(this.studentName, this.studentRoll);
            }
          }, 1000);
        }
      });

      this.ws.on('error', (err) => {
        console.error('[CLASSROOM-DISC] WS error:', err.message);
        this.ws = null;
        this.connected = false;
      });
    } catch (err) {
      console.error('[CLASSROOM-DISC] Connect error:', err.message);
    }
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'code-sync':
        if (this.onCodeSync) this.onCodeSync(msg);
        break;
      case 'code-change':
        if (this.onCodeChange) this.onCodeChange(msg);
        break;
      case 'view-request':
        if (this.onViewRequest) this.onViewRequest();
        break;
      case 'edit-request':
        if (this.onEditRequest) this.onEditRequest();
        break;
      case 'edit-code':
        if (this.onEditCode) this.onEditCode(msg);
        break;
      case 'edit-live':
        if (this.onEditLive) this.onEditLive(msg);
        break;
      case 'session-end':
        this.connected = false;
        if (this.onSessionEnd) this.onSessionEnd();
        break;
      case 'terminal':
        if (this.onTerminal) this.onTerminal(msg);
        break;
      case 'cursor':
        if (this.onCursor) this.onCursor(msg);
        break;
      case 'selection':
        if (this.onSelection) this.onSelection(msg);
        break;
      case 'chat-message':
        if (this.onChatMessage) this.onChatMessage(msg);
        break;
    }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch (_) {}
    }
  }
}

module.exports = { ClassroomDiscovery };

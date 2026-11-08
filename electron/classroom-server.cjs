/**
 * THETA172 — Classroom Server (Teacher Side)
 * UDP broadcaster + WebSocket server for real-time classroom coding.
 * Runs inside Electron main process.
 */

const dgram = require('dgram');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');

const UDP_PORT = 41234;
const WS_PORT  = 41235;
const BROADCAST_INTERVAL = 500; // ms

class ClassroomServer {
  constructor() {
    this.teacherName = '';
    this.wss = null;
    this.udpSocket = null;
    this.broadcastTimer = null;
    this.students = new Map(); // socketId -> { ws, name, roll, code, fileName, helpRequested, editPermission }
    this.nextId = 1;
    this.running = false;
    this.onStudentJoin = null;
    this.onStudentLeave = null;
    this.onHelpRequest = null;
    this.onStudentCode = null;
    this.onStudentCodeLive = null;
    this.onStudentOutputLive = null;
    this.onEditGrant = null;
    this.onEditRevoke = null;
    this.onChatMessage = null;
  }

  /**
   * Get the local network IP address (not 127.0.0.1)
   */
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * Start the classroom server (UDP broadcast + WebSocket)
   */
  start(teacherName) {
    if (this.running) return { success: false, error: 'Already running' };

    this.teacherName = teacherName;
    const localIP = this.getLocalIP();

    try {
      // Start WebSocket server
      this.wss = new WebSocketServer({ port: WS_PORT, host: '0.0.0.0' });

      this.wss.on('connection', (ws) => {
        const id = `student-${this.nextId++}`;
        this.students.set(id, { ws, name: '', roll: '', code: '', fileName: '', helpRequested: false, editPermission: false });

        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            this._handleStudentMessage(id, msg);
          } catch (_) {}
        });

        ws.on('close', () => {
          const student = this.students.get(id);
          this.students.delete(id);
          if (student && this.onStudentLeave) {
            this.onStudentLeave({ id, name: student.name, roll: student.roll });
          }
        });

        ws.on('error', () => {
          this.students.delete(id);
        });
      });

      this.wss.on('error', (err) => {
        console.error('[CLASSROOM] WS server error:', err.message);
      });

      // Start UDP broadcast
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.udpSocket.on('error', (err) => {
        console.error('[CLASSROOM] UDP error:', err.message);
      });

      this.udpSocket.bind(0, () => {
        this.udpSocket.setBroadcast(true);

        const packet = JSON.stringify({
          type: 'THETA_CLASSROOM',
          teacher: this.teacherName,
          ip: localIP,
          wsPort: WS_PORT,
        });

        const buf = Buffer.from(packet);

        this.broadcastTimer = setInterval(() => {
          // Broadcast to all common subnet broadcast addresses
          try {
            this.udpSocket.send(buf, 0, buf.length, UDP_PORT, '255.255.255.255');
          } catch (_) {}
        }, BROADCAST_INTERVAL);
      });

      this.running = true;
      return { success: true, ip: localIP, port: WS_PORT };
    } catch (err) {
      this.stop();
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop the classroom server
   */
  stop() {
    this.running = false;

    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }

    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch (_) {}
      this.udpSocket = null;
    }

    // Notify all students
    this.students.forEach((student) => {
      try {
        student.ws.send(JSON.stringify({ type: 'session-end' }));
        student.ws.close();
      } catch (_) {}
    });
    this.students.clear();

    if (this.wss) {
      try { this.wss.close(); } catch (_) {}
      this.wss = null;
    }
  }

  /**
   * Broadcast teacher's code to all students (full sync)
   */
  broadcastCode(code, cursor, fileName) {
    const msg = JSON.stringify({ type: 'code-sync', code, cursor, fileName });
    this._broadcast(msg);
  }

  /**
   * Broadcast terminal output to all students
   */
  broadcastTerminal(text, stream) {
    const msg = JSON.stringify({ type: 'terminal', text, stream });
    this._broadcast(msg);
  }

  /**
   * Broadcast cursor position to all students
   */
  broadcastCursor(line, col) {
    const msg = JSON.stringify({ type: 'cursor', line, col });
    this._broadcast(msg);
  }

  /**
   * Broadcast text selection ranges to all students
   */
  broadcastSelection(ranges) {
    const msg = JSON.stringify({ type: 'selection', ranges });
    this._broadcast(msg);
  }

  /**
   * Broadcast incremental code change to all students
   */
  broadcastChange(from, to, insert) {
    const msg = JSON.stringify({ type: 'code-change', from, to, insert });
    this._broadcast(msg);
  }

  /**
   * Request to view a student's code
   */
  requestStudentCode(studentId) {
    const student = this.students.get(studentId);
    if (student && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(JSON.stringify({ type: 'view-request' }));
    }
  }

  /**
   * Request edit permission from a student
   */
  requestEditPermission(studentId) {
    const student = this.students.get(studentId);
    if (student && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(JSON.stringify({ type: 'edit-request' }));
    }
  }

  /**
   * Send full code edit to student (push entire code)
   */
  sendEditToStudent(studentId, code) {
    const student = this.students.get(studentId);
    if (student && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(JSON.stringify({ type: 'edit-code', code }));
    }
  }

  /**
   * Send incremental live edit to student's editor
   */
  sendLiveEdit(studentId, from, to, insert) {
    const student = this.students.get(studentId);
    if (student && student.editPermission && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(JSON.stringify({ type: 'edit-live', from, to, insert }));
    }
  }

  /**
   * Check if teacher has edit permission for a student
   */
  hasEditPermission(studentId) {
    const student = this.students.get(studentId);
    return student ? student.editPermission : false;
  }

  /**
   * Send a chat message. If targetId is 'broadcast', send to all. Otherwise, send to a specific student.
   */
  sendChatMessage(text, targetId, senderName) {
    const payload = JSON.stringify({ type: 'chat-message', text, senderName, target: targetId });
    if (targetId === 'broadcast') {
      this._broadcast(payload);
    } else {
      const student = this.students.get(targetId);
      if (student && student.ws.readyState === WebSocket.OPEN) {
        try { student.ws.send(payload); } catch (_) {}
      }
    }
  }

  /**
   * Get list of connected students
   */
  getStudents() {
    const list = [];
    this.students.forEach((s, id) => {
      list.push({ id, name: s.name, roll: s.roll, helpRequested: s.helpRequested, editPermission: s.editPermission });
    });
    return list;
  }

  /**
   * Clear help request flag for a student
   */
  clearHelp(studentId) {
    const student = this.students.get(studentId);
    if (student) student.helpRequested = false;
  }

  // ── Internal ──

  _handleStudentMessage(id, msg) {
    const student = this.students.get(id);
    if (!student) return;

    switch (msg.type) {
      case 'join':
        student.name = msg.name || 'Unknown';
        student.roll = msg.roll || '';
        if (this.onStudentJoin) {
          this.onStudentJoin({ id, name: student.name, roll: student.roll });
        }
        break;

      case 'help-request':
        student.helpRequested = true;
        if (this.onHelpRequest) {
          this.onHelpRequest({ id, name: student.name, roll: student.roll, message: msg.message || '' });
        }
        break;

      case 'student-code':
        student.code = msg.code || '';
        student.fileName = msg.fileName || 'main.py';
        if (this.onStudentCode) {
          this.onStudentCode({ id, name: student.name, roll: student.roll, code: student.code, fileName: student.fileName });
        }
        break;

      case 'student-code-live':
        student.code = msg.code || '';
        student.fileName = msg.fileName || 'main.py';
        if (this.onStudentCodeLive) {
          this.onStudentCodeLive({ id, name: student.name, roll: student.roll, code: student.code, fileName: student.fileName });
        }
        break;

      case 'student-output':
        if (this.onStudentOutputLive) {
          this.onStudentOutputLive({ id, name: student.name, text: msg.text || '', stream: msg.stream || 'stdout' });
        }
        break;

      case 'edit-grant':
        student.editPermission = !!msg.granted;
        if (this.onEditGrant) {
          this.onEditGrant({ id, name: student.name, roll: student.roll, granted: !!msg.granted });
        }
        break;

      case 'edit-revoke':
        student.editPermission = false;
        if (this.onEditRevoke) {
          this.onEditRevoke({ id, name: student.name, roll: student.roll });
        }
        break;

      case 'chat-message':
        if (this.onChatMessage) {
          this.onChatMessage({ id, name: student.name, text: msg.text || '', target: msg.target || 'broadcast' });
        }
        break;
    }
  }

  _broadcast(msg) {
    this.students.forEach((student) => {
      if (student.ws.readyState === WebSocket.OPEN) {
        try { student.ws.send(msg); } catch (_) {}
      }
    });
  }
}

module.exports = { ClassroomServer };

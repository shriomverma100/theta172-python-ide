/**
 * THETA172 — Classroom Server (Teacher Side)
 *
 * Students reach the teacher two ways at once:
 *   - on the same network: a direct WebSocket (found by UDP broadcast);
 *   - from anywhere else: the internet relay, with a short join code.
 * A student is known by the random id their app sends when joining, not
 * by the connection, so they keep their place (code, hand raised, edit
 * permission) when their connection drops or moves from one route to the
 * other. Every message goes through a ReliableChannel, so nothing is lost
 * while a student reconnects. Runs inside the Electron main process.
 */

'use strict';

const dgram = require('dgram');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');
const { sanitizeLabel, sanitizeText } = require('./validate.cjs');
const { ReliableChannel } = require('./classroom-channel.cjs');
const { RelayHost, validRelayUrl } = require('./classroom-relay.cjs');

const UDP_PORT = 41234;
const WS_PORT = 41235;
const BROADCAST_INTERVAL = 500; // ms
const MAX_PAYLOAD = 1024 * 1024; // 1 MB per message
const MAX_CODE = 500_000;        // characters
const PROTOCOL = 2;
const STUDENT_GRACE_MS = 45_000; // a student's place is kept this long while they reconnect
const PING_MS = 10_000;          // LAN heartbeat; a socket that misses two is dropped

const CLIENT_ID = /^[\w-]{8,64}$/;

/** Every IPv4 broadcast address of this machine's networks (plus the global one). */
function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || !i.netmask) continue;
      const ip = i.address.split('.').map(Number);
      const mask = i.netmask.split('.').map(Number);
      out.add(ip.map((b, k) => (b | (~mask[k] & 255))).join('.'));
    }
  }
  return [...out];
}

class ClassroomServer {
  /**
   * @param {object} [deps] for tests
   * @param {boolean} [deps.lan=true]   listen on the local network
   * @param {boolean} [deps.udp=true]   announce the class by UDP broadcast
   * @param {number}  [deps.port]       WebSocket port (0 = any free port)
   */
  constructor(deps = {}) {
    this.deps = { lan: true, udp: true, port: WS_PORT, ...deps };
    this.teacherName = '';
    this.wss = null;
    this.port = null;
    this.udpSocket = null;
    this.broadcastTimer = null;
    this.pingTimer = null;
    this.relay = null;
    this.relayUrl = null;
    this.relayState = { state: 'off', code: null };
    this.classId = null;
    this.students = new Map();  // id -> student
    this.byClient = new Map();  // clientId -> id
    this.relayPeers = new Map(); // relay peer id -> link
    this.nextId = 1;
    this.running = false;
    this.onStudentJoin = null;
    this.onStudentLeave = null;
    this.onStudentStatus = null;
    this.onRelayStatus = null;
    this.onHelpRequest = null;
    this.onStudentCode = null;
    this.onStudentCodeLive = null;
    this.onStudentOutputLive = null;
    this.onEditGrant = null;
    this.onEditRevoke = null;
    this.onChatMessage = null;
    this.onStudentEvent = null; // other student messages (pulse, mastery, …): (studentInfo, msg)
  }

  /** The local network IP address (not 127.0.0.1). */
  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return '127.0.0.1';
  }

  /**
   * Start the class: the local network server now, the relay in the background.
   * @param {string} teacherName
   * @param {{ relayUrl?: string }} [opts]
   * @returns {Promise<{ success: boolean, ip?: string, port?: number, error?: string }>}
   */
  async start(teacherName, { relayUrl } = {}) {
    if (this.running) return { success: false, error: 'Already running' };
    this.teacherName = sanitizeLabel(teacherName, 64, 'Teacher');
    this.classId = crypto.randomBytes(8).toString('hex');
    this.running = true;
    let lanError = null;

    if (this.deps.lan) {
      try {
        await this._listen(this.deps.port);
      } catch (err) {
        // The usual port is taken (another app, a second window): any free port works, the broadcast says which
        try { await this._listen(0); } catch (err2) { lanError = err2.message || err.message; }
      }
      if (this.wss && this.deps.udp) this._startBroadcast();
      if (this.wss) this.pingTimer = setInterval(() => this._pingLan(), PING_MS);
    }

    if (relayUrl && validRelayUrl(relayUrl)) this._startRelay(relayUrl);
    else this._setRelayState({ state: relayUrl ? 'invalid' : 'off', code: null });

    if (!this.wss && !this.relay) {
      this.stop();
      return { success: false, error: lanError || 'Could not start the class.' };
    }
    return { success: true, ip: this.getLocalIP(), port: this.port, lan: !!this.wss, lanError };
  }

  _listen(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: MAX_PAYLOAD });
      const fail = (err) => { try { wss.close(); } catch (_) { /* gone */ } reject(err); };
      wss.once('error', fail);
      wss.once('listening', () => {
        wss.off('error', fail);
        wss.on('error', (err) => console.error('[CLASSROOM] WS server error:', err.message));
        wss.on('connection', (ws) => this._acceptLan(ws));
        this.wss = wss;
        this.port = wss.address().port;
        resolve();
      });
    });
  }

  _startBroadcast() {
    this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udpSocket.on('error', (err) => console.error('[CLASSROOM] UDP error:', err.message));
    this.udpSocket.bind(0, () => {
      try { this.udpSocket.setBroadcast(true); } catch (_) { return; }
      let tick = 0;
      let targets = broadcastAddresses();
      this.broadcastTimer = setInterval(() => {
        // Networks change (Wi-Fi switch, hotspot): look again every few seconds
        if (++tick % 10 === 0) targets = broadcastAddresses();
        const buf = Buffer.from(JSON.stringify({
          type: 'THETA_CLASSROOM', proto: PROTOCOL, teacher: this.teacherName, ip: this.getLocalIP(),
          wsPort: this.port, classId: this.classId, code: this.relayState.code || null,
        }));
        for (const addr of targets) {
          try { this.udpSocket?.send(buf, 0, buf.length, UDP_PORT, addr); } catch (_) { /* network went away */ }
        }
      }, BROADCAST_INTERVAL);
    });
  }

  _startRelay(url) {
    this.relayUrl = url;
    this.relay = new RelayHost({
      url,
      name: this.teacherName,
      onStatus: (s) => this._setRelayState(s),
      onError: (message) => this._setRelayState({ state: 'error', code: this.relayState.code, message }),
      onPeerJoin: (peerId) => {
        const link = this._makeLink('internet', (text) => this.relay?.sendTo(peerId, text), () => {});
        this.relayPeers.set(peerId, link);
      },
      onPeerLeave: (peerId) => {
        const link = this.relayPeers.get(peerId);
        this.relayPeers.delete(peerId);
        link?.closed();
      },
      onPeerData: (peerId, text) => {
        let link = this.relayPeers.get(peerId);
        if (!link) { // data before the join notice (after a teacher reconnect)
          link = this._makeLink('internet', (t) => this.relay?.sendTo(peerId, t), () => {});
          this.relayPeers.set(peerId, link);
        }
        link.received(text);
      },
    });
    this.relay.start();
  }

  _setRelayState(s) {
    this.relayState = { ...s };
    this.onRelayStatus?.(this.relayState);
  }

  /** Where students can reach the class. */
  getStatus() {
    return { running: this.running, ip: this.getLocalIP(), port: this.port, lan: !!this.wss, relay: this.relayState };
  }

  // ── Links (one connection, of either kind) ───────────────────────

  /**
   * A connection from a student. Its first message must be the hello
   * ({ type: 'join', proto, clientId, name, roll }); after that it carries
   * channel frames for that student.
   */
  _makeLink(via, sendText, close) {
    const link = {
      via,
      student: null,
      isClosed: false,
      send: (obj) => {
        if (link.isClosed) return false;
        try { return sendText(JSON.stringify(obj)) !== false; } catch (_) { return false; }
      },
      close: () => { if (!link.isClosed) { try { close(); } catch (_) { /* gone */ } } link.closed(); },
      received: (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch (_) { return; }
        if (!msg || typeof msg !== 'object') return;
        if (!link.student) {
          if (msg.type === 'join') this._hello(link, msg);
          return;
        }
        link.student.channel.receive(msg);
      },
      closed: () => {
        if (link.isClosed) return;
        link.isClosed = true;
        const s = link.student;
        if (s && s.link === link) this._away(s);
      },
    };
    return link;
  }

  _acceptLan(ws) {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const link = this._makeLink('lan', (text) => {
      if (ws.readyState !== WebSocket.OPEN) return false;
      ws.send(text);
      return true;
    }, () => ws.close());
    ws.on('message', (raw) => { ws.isAlive = true; link.received(raw.toString()); });
    ws.on('close', () => link.closed());
    ws.on('error', () => link.closed());
  }

  _pingLan() {
    for (const ws of this.wss?.clients || []) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) { /* gone */ }
    }
  }

  /** A student said hello on a link: a new student, or one coming back. */
  _hello(link, msg) {
    if (msg.proto !== PROTOCOL || typeof msg.clientId !== 'string' || !CLIENT_ID.test(msg.clientId)) {
      // An older app: tell it plainly instead of failing silently
      link.send({ type: 'session-end', reason: 'update', message: 'Update THETA172 to join this class.' });
      setTimeout(() => link.close(), 200);
      return;
    }
    const known = this.byClient.get(msg.clientId);
    let s = known && this.students.get(known);
    if (s) {
      // Back again (maybe by the other route): the old link, if still open, is replaced
      clearTimeout(s.graceTimer);
      s.graceTimer = null;
      const old = s.link;
      s.link = null;
      if (old && old !== link) { old.student = null; old.close(); }
    } else {
      const id = `student-${this.nextId++}`;
      s = {
        id, clientId: msg.clientId, name: '', roll: '', code: '', fileName: '', helpRequested: false,
        editPermission: false, link: null, via: link.via, graceTimer: null, joinedAt: Date.now(),
      };
      s.channel = new ReliableChannel({
        transmit: (frame) => (s.link ? s.link.send(frame) : false),
        deliver: (m) => this._handleStudentMessage(s.id, m),
      });
      this.students.set(id, s);
      this.byClient.set(msg.clientId, id);
    }
    s.name = sanitizeLabel(msg.name, 64, 'Unknown');
    s.roll = sanitizeLabel(msg.roll, 32, '');
    s.via = link.via;
    s.link = link;
    link.student = s;
    link.send({
      type: 'welcome', proto: PROTOCOL, teacher: this.teacherName, classId: this.classId,
      code: this.relayState.code || null, relayUrl: this.relayUrl || null,
    });
    s.channel.linkUp();
    if (known) this.onStudentStatus?.({ id: s.id, name: s.name, roll: s.roll, state: 'online', via: s.via });
    else this.onStudentJoin?.({ id: s.id, name: s.name, roll: s.roll, via: s.via });
  }

  /** A student's connection dropped: keep their place for a while. */
  _away(s) {
    s.link = null;
    s.channel.linkDown();
    if (!this.students.has(s.id)) return;
    this.onStudentStatus?.({ id: s.id, name: s.name, roll: s.roll, state: 'away', via: s.via });
    clearTimeout(s.graceTimer);
    s.graceTimer = setTimeout(() => this._remove(s.id), STUDENT_GRACE_MS);
  }

  _remove(id) {
    const s = this.students.get(id);
    if (!s) return;
    clearTimeout(s.graceTimer);
    this.students.delete(id);
    this.byClient.delete(s.clientId);
    s.channel.dispose();
    if (s.link) { s.link.student = null; s.link.close(); }
    this.onStudentLeave?.({ id, name: s.name, roll: s.roll });
  }

  // ── Stopping ─────────────────────────────────────────────────────

  stop() {
    this.running = false;
    clearInterval(this.broadcastTimer);
    this.broadcastTimer = null;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch (_) { /* gone */ }
      this.udpSocket = null;
    }
    // Tell everyone directly (the channel would wait for acknowledgements)
    for (const s of this.students.values()) {
      clearTimeout(s.graceTimer);
      s.link?.send({ type: 'session-end' });
      s.channel.dispose();
    }
    const leaving = [...this.students.values()];
    this.students.clear();
    setTimeout(() => {
      for (const s of leaving) {
        const link = s.link;
        s.link = null;
        if (link) { link.student = null; link.close(); }
      }
    }, 150);
    this.byClient.clear();
    this.relayPeers.clear();
    if (this.relay) { this.relay.close(); this.relay = null; }
    this._setRelayState({ state: 'off', code: null });
    if (this.wss) {
      for (const ws of this.wss.clients) { try { ws.close(); } catch (_) { /* gone */ } }
      try { this.wss.close(); } catch (_) { /* gone */ }
      this.wss = null;
    }
    this.port = null;
  }

  // ── Sending ──────────────────────────────────────────────────────

  _sendTo(s, msg, key) { s?.channel.send(msg, key ? { key } : {}); }

  _broadcast(msg, key) {
    for (const s of this.students.values()) this._sendTo(s, msg, key);
  }

  /** Teacher's code to all students (latest wins). */
  broadcastCode(code, cursor, fileName) { this._broadcast({ type: 'code-sync', code, cursor, fileName }, 'code'); }
  broadcastTerminal(text, stream) { this._broadcast({ type: 'terminal', text, stream }); }
  broadcastCursor(line, col) { this._broadcast({ type: 'cursor', line, col }, 'cursor'); }
  broadcastSelection(ranges) { this._broadcast({ type: 'selection', ranges }, 'selection'); }
  broadcastChange(from, to, insert) { this._broadcast({ type: 'code-change', from, to, insert }, 'code-change'); }

  /** Any classroom message to one student or ('*') everyone. */
  sendEvent(target, msg, key) {
    if (target === '*') this._broadcast(msg, key);
    else this._sendTo(this.students.get(target), msg, key);
  }

  requestStudentCode(studentId) { this._sendTo(this.students.get(studentId), { type: 'view-request' }); }
  requestEditPermission(studentId) { this._sendTo(this.students.get(studentId), { type: 'edit-request' }); }
  sendEditToStudent(studentId, code) { this._sendTo(this.students.get(studentId), { type: 'edit-code', code }); }

  sendLiveEdit(studentId, from, to, insert) {
    const s = this.students.get(studentId);
    if (s?.editPermission) this._sendTo(s, { type: 'edit-live', from, to, insert });
  }

  hasEditPermission(studentId) { return !!this.students.get(studentId)?.editPermission; }

  /** A chat message to everyone ('broadcast') or one student. */
  sendChatMessage(text, targetId, senderName) {
    const msg = { type: 'chat-message', text, senderName, target: targetId };
    if (targetId === 'broadcast') this._broadcast(msg);
    else this._sendTo(this.students.get(targetId), msg);
  }

  getStudents() {
    return [...this.students.values()].map((s) => ({
      id: s.id, name: s.name, roll: s.roll, helpRequested: s.helpRequested, editPermission: s.editPermission,
      via: s.via, online: !!s.link,
    }));
  }

  clearHelp(studentId) {
    const s = this.students.get(studentId);
    if (s) s.helpRequested = false;
  }

  // ── From students ────────────────────────────────────────────────

  _handleStudentMessage(id, msg) {
    const student = this.students.get(id);
    if (!student || !msg || typeof msg !== 'object') return;
    const who = { id, name: student.name, roll: student.roll };

    switch (msg.type) {
      case 'help-request':
        student.helpRequested = true;
        this.onHelpRequest?.({ ...who, message: sanitizeText(msg.message, 500), error: sanitizeError(msg.error) });
        break;
      case 'student-code':
        student.code = typeof msg.code === 'string' ? msg.code.slice(0, MAX_CODE) : '';
        student.fileName = sanitizeLabel(msg.fileName, 128, 'main.py');
        this.onStudentCode?.({ ...who, code: student.code, fileName: student.fileName });
        break;
      case 'student-code-live':
        student.code = typeof msg.code === 'string' ? msg.code.slice(0, MAX_CODE) : '';
        student.fileName = sanitizeLabel(msg.fileName, 128, 'main.py');
        this.onStudentCodeLive?.({ ...who, code: student.code, fileName: student.fileName });
        break;
      case 'student-output':
        this.onStudentOutputLive?.({ ...who, text: sanitizeText(msg.text, 20_000), stream: msg.stream === 'stderr' ? 'stderr' : 'stdout' });
        break;
      case 'edit-grant':
        student.editPermission = !!msg.granted;
        this.onEditGrant?.({ ...who, granted: !!msg.granted });
        break;
      case 'edit-revoke':
        student.editPermission = false;
        this.onEditRevoke?.(who);
        break;
      case 'chat-message':
        this.onChatMessage?.({ ...who, text: sanitizeText(msg.text, 2000), target: 'teacher' });
        break;
      case 'leave':
        this._remove(id);
        break;
      default:
        // Class pulse, runs, predictions, mastery: validated by the renderer's classroom module
        if (typeof msg.type === 'string' && /^[a-z][a-z-]{1,40}$/.test(msg.type)) {
          let size = 0;
          try { size = JSON.stringify(msg).length; } catch (_) { return; }
          if (size <= 64 * 1024) this.onStudentEvent?.(who, msg);
        }
    }
  }
}

/** A student's error summary: { type, message, line } with plain short strings. */
function sanitizeError(e) {
  if (!e || typeof e !== 'object') return null;
  return {
    type: sanitizeLabel(e.type, 64, ''),
    message: sanitizeText(e.message, 300),
    line: Number.isInteger(e.line) && e.line > 0 && e.line < 1e6 ? e.line : null,
  };
}

module.exports = { ClassroomServer, PROTOCOL, broadcastAddresses };

/**
 * THETA172 — Classroom connection (Student Side)
 *
 * A student reaches the teacher by whichever route works:
 *   - the same network: found by the teacher's UDP broadcast, direct WebSocket;
 *   - anywhere else: the internet relay, using the class join code.
 * Both are tried; the local route is preferred (faster, works without
 * internet). When the connection drops, the student keeps trying both
 * routes until the class is back, and the ReliableChannel resends
 * anything that did not arrive, so the session carries on where it was.
 * Runs inside the Electron main process.
 */

'use strict';

const dgram = require('dgram');
const crypto = require('crypto');
const WebSocket = require('ws');
const net = require('net');
const { sanitizeLabel } = require('./validate.cjs');
const { ReliableChannel, backoff } = require('./classroom-channel.cjs');
const { RelayJoin, validRelayUrl } = require('./classroom-relay.cjs');
const { PROTOCOL } = require('./classroom-server.cjs');

const UDP_PORT = 41234;
const LAN_FRESH_MS = 6000;        // a broadcast this recent means the teacher is on our network
const LAN_DEAD_MS = 30_000;       // the teacher pings every 10 s
const GIVE_UP_MS = 15 * 60_000;   // nothing from the class for this long: it is over
const CODE_RE = /^[A-Z0-9]{6}$/;

const normalizeCode = (raw) => (typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '');

class ClassroomDiscovery {
  /**
   * @param {object} [deps] for tests
   * @param {boolean} [deps.udp=true]  listen for teacher broadcasts
   */
  constructor(deps = {}) {
    this.deps = { udp: true, ...deps };
    this.clientId = crypto.randomBytes(12).toString('base64url'); // who we are to the teacher, for this app run
    this.udpSocket = null;
    this.studentName = '';
    this.studentRoll = '';
    this.connected = false;   // a link is up and the teacher said welcome
    this.discovering = false; // in a class or looking for one
    this.everConnected = false;
    this.teacherInfo = null;
    this.classId = null;
    this.code = null;
    this.relayUrl = null;
    this.lan = null;        // { ws, link, endpoint }
    this.lanEndpoint = null; // { ip, port, seenAt, classId }
    this.relay = null;      // RelayJoin
    this.relayLink = null;
    this.active = null;     // the link carrying the channel
    this.via = null;
    this.lastHeard = 0;
    this.lanAttempt = 0;
    this.lanTimer = null;
    this.giveUpTimer = null;
    this.channel = null;

    // Callbacks (main.cjs forwards them to the window)
    this.onTeacherFound = null;
    this.onConnected = null;
    this.onDisconnected = null;
    this.onLinkStatus = null; // ({ state: 'searching'|'connected'|'reconnecting'|'teacher-away', via, code, teacher })
    this.onJoinError = null;  // (message) e.g. a wrong code
    this.onCodeSync = null;
    this.onCodeChange = null;
    this.onViewRequest = null;
    this.onEditRequest = null;
    this.onEditCode = null;
    this.onEditLive = null;
    this.onSessionEnd = null;
    this.onTerminal = null;
    this.onCursor = null;
    this.onSelection = null;
    this.onChatMessage = null;
    this.onClassEvent = null; // other teacher messages (pulse, help routing, predictions …)
  }

  /**
   * Look for the class: on this network, and with the join code (if given) through the relay.
   * @param {string} name
   * @param {string} roll
   * @param {{ code?: string, relayUrl?: string }} [opts]
   */
  startDiscovery(name, roll, { code, relayUrl } = {}) {
    if (this.discovering) return;
    this.studentName = name;
    this.studentRoll = roll;
    this.discovering = true;
    this.everConnected = false;
    this.code = CODE_RE.test(normalizeCode(code)) ? normalizeCode(code) : null;
    this.relayUrl = validRelayUrl(relayUrl) ? relayUrl : null;
    this.channel = new ReliableChannel({
      transmit: (frame) => (this.active ? this.active.send(frame) : false),
      deliver: (msg) => this._handleMessage(msg),
    });
    if (this.deps.udp) this._listenUdp();
    if (this.code && this.relayUrl) this._startRelay();
    this._status('searching');
    this._armGiveUp();
  }

  /** Leave the class (or stop looking). */
  stopDiscovery() {
    if (this.connected) this.channel?.send({ type: 'leave' });
    const wasIn = this.discovering;
    this.discovering = false;
    this.connected = false;
    this.teacherInfo = null;
    clearTimeout(this.lanTimer);
    clearTimeout(this.giveUpTimer);
    // Let the leave message go out, then close everything
    const lan = this.lan;
    const relay = this.relay;
    this.lan = null;
    this.relay = null;
    this.active = null;
    setTimeout(() => {
      if (lan) { try { lan.ws.close(); } catch (_) { /* gone */ } }
      relay?.leave();
    }, wasIn ? 120 : 0);
    this.channel?.dispose();
    this.channel = null;
    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch (_) { /* gone */ }
      this.udpSocket = null;
    }
    this.classId = null;
    this.lanEndpoint = null;
  }

  /** Join with a code while already looking (typed after "Join"). */
  joinWithCode(code, relayUrl) {
    const c = normalizeCode(code);
    if (!CODE_RE.test(c)) return false;
    this.code = c;
    if (validRelayUrl(relayUrl)) this.relayUrl = relayUrl;
    if (!this.relayUrl) return false;
    if (this.relay) { this.relay.stop(); this.relay = null; }
    this._startRelay();
    return true;
  }

  // ── Messages to the teacher ──────────────────────────────────────

  _send(msg, key) { this.channel?.send(msg, key ? { key } : {}); }

  sendHelpRequest(message, error) { this._send({ type: 'help-request', message, error }); }
  sendCode(code, fileName) { this._send({ type: 'student-code', code, fileName }); }
  grantEditPermission(granted) { this._send({ type: 'edit-grant', granted }); }
  revokeEditPermission() { this._send({ type: 'edit-revoke' }); }
  sendCodeLive(code, fileName) { this._send({ type: 'student-code-live', code, fileName }, 'code-live'); }
  sendOutputLive(text, stream) { this._send({ type: 'student-output', text, stream }); }
  sendChatMessage(text, target) { this._send({ type: 'chat-message', text, target }); }
  /** Classroom events (run results, predictions, pulse …); `key` makes it latest-wins. */
  sendEvent(msg, key) { this._send(msg, key); }

  getStatus() {
    return {
      inClass: this.discovering, connected: this.connected, via: this.via, code: this.code,
      teacher: this.teacherInfo?.teacher || null, pending: this.channel?.pending || 0,
    };
  }

  // ── Local network ────────────────────────────────────────────────

  _listenUdp() {
    try {
      this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udpSocket.on('message', (buf) => this._beacon(buf));
      this.udpSocket.on('error', (err) => console.error('[CLASSROOM-DISC] UDP error:', err.message));
      this.udpSocket.bind(UDP_PORT, '0.0.0.0');
    } catch (err) {
      console.error('[CLASSROOM-DISC] Failed to start discovery:', err.message);
    }
  }

  /** A teacher's broadcast. Broadcasts are unauthenticated: only plain values are accepted. */
  _beacon(buf) {
    if (!this.discovering) return;
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
    if (msg?.type !== 'THETA_CLASSROOM') return;
    if (typeof msg.ip !== 'string' || !net.isIPv4(msg.ip)) return;
    if (!Number.isInteger(msg.wsPort) || msg.wsPort < 1 || msg.wsPort > 65535) return;
    const classId = typeof msg.classId === 'string' && /^[0-9a-f]{16}$/.test(msg.classId) ? msg.classId : null;
    const beaconCode = normalizeCode(msg.code || '');
    // In a class (or joining one by code): only that class's teacher counts
    if (this.classId && classId !== this.classId) return;
    if (!this.classId && this.code && CODE_RE.test(beaconCode) && beaconCode !== this.code) return;
    const fresh = !this.lanEndpoint || this.lanEndpoint.ip !== msg.ip || this.lanEndpoint.port !== msg.wsPort;
    this.lanEndpoint = { ip: msg.ip, port: msg.wsPort, seenAt: Date.now(), classId };
    if (!this.teacherInfo) {
      this.teacherInfo = { teacher: sanitizeLabel(msg.teacher, 64, 'Teacher'), ip: msg.ip, wsPort: msg.wsPort };
      this.onTeacherFound?.(this.teacherInfo);
    }
    if (CODE_RE.test(beaconCode) && !this.code) this.code = beaconCode; // a way back through the internet if this network fails
    // Prefer the local route: connect when not on it (also when the teacher's address changed)
    if (this.via !== 'lan' && (!this.lan || fresh)) this._connectLan();
  }

  _connectLan() {
    const ep = this.lanEndpoint;
    if (!ep || !this.discovering) return;
    if (this.lan) { try { this.lan.ws.terminate(); } catch (_) { /* gone */ } this.lan = null; }
    let ws;
    try {
      ws = new WebSocket(`ws://${ep.ip}:${ep.port}`, { maxPayload: 1024 * 1024, handshakeTimeout: 5000 });
    } catch (_) { return; }
    const link = {
      via: 'lan',
      send: (frame) => {
        if (ws.readyState !== WebSocket.OPEN) return false;
        try { ws.send(JSON.stringify(frame)); return true; } catch (_) { return false; }
      },
    };
    const lan = { ws, link, deadTimer: null };
    this.lan = lan;
    const alive = () => {
      clearTimeout(lan.deadTimer);
      lan.deadTimer = setTimeout(() => { try { ws.terminate(); } catch (_) { /* gone */ } }, LAN_DEAD_MS);
    };
    ws.on('open', () => { alive(); link.send(this._hello()); });
    ws.on('ping', alive);
    ws.on('message', (raw) => {
      alive();
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      this._fromLink(link, msg);
    });
    ws.on('close', () => {
      clearTimeout(lan.deadTimer);
      if (this.lan === lan) this.lan = null;
      this._linkLost(link);
      // Try the local route again while the teacher still broadcasts here
      if (this.discovering && this.lanEndpoint && Date.now() - this.lanEndpoint.seenAt < LAN_FRESH_MS) {
        clearTimeout(this.lanTimer);
        this.lanTimer = setTimeout(() => { if (!this.lan && this.via !== 'lan') this._connectLan(); }, backoff(this.lanAttempt++));
      }
    });
    ws.on('error', () => { /* close follows */ });
  }

  // ── Internet relay ───────────────────────────────────────────────

  _startRelay() {
    if (this.relay || !this.code || !this.relayUrl || !this.discovering) return;
    const link = { via: 'internet', send: (frame) => !!this.relay?.send(JSON.stringify(frame)) };
    this.relayLink = link;
    this.relay = new RelayJoin({
      url: this.relayUrl,
      code: this.code,
      onReady: () => link.send(this._hello()),
      onData: (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch (_) { return; }
        this._fromLink(link, msg);
      },
      onDown: () => this._linkLost(link),
      onHostAway: () => { if (this.active === link) this._status('teacher-away'); },
      // The teacher reconnected to the relay: say hello again so they know this link is us
      onHostBack: () => link.send(this._hello()),
      onEnded: () => this._ended(),
      onError: (code, message) => {
        if (code === 'BAD_CODE' && !this.everConnected) {
          // A typo, most likely: stop asking the relay with this code
          this.relay?.stop();
          this.relay = null;
          this.onJoinError?.(message);
        }
      },
    });
    this.relay.start();
  }

  // ── Both routes ──────────────────────────────────────────────────

  _hello() {
    return { type: 'join', proto: PROTOCOL, clientId: this.clientId, name: this.studentName, roll: this.studentRoll };
  }

  /** A message on a link: the welcome makes it the active link; the rest is channel traffic. */
  _fromLink(link, msg) {
    if (!msg || typeof msg !== 'object' || !this.discovering) return;
    this.lastHeard = Date.now();
    this._armGiveUp();
    if (msg.type === 'welcome') {
      if (typeof msg.classId === 'string' && /^[0-9a-f]{16}$/.test(msg.classId)) {
        if (this.classId && this.classId !== msg.classId) return; // a different class
        this.classId = msg.classId;
      }
      const c = normalizeCode(msg.code || '');
      if (CODE_RE.test(c)) this.code = c;
      if (!this.relayUrl && validRelayUrl(msg.relayUrl) && String(msg.relayUrl).startsWith('wss:')) this.relayUrl = msg.relayUrl;
      this.teacherInfo = { ...(this.teacherInfo || {}), teacher: sanitizeLabel(msg.teacher, 64, 'Teacher') };
      this._activate(link);
      return;
    }
    if (msg.type === 'session-end' && !Number.isInteger(msg.s)) {
      // Sent directly (outside the channel) when the class ends or our app is too old
      if (msg.reason === 'update') this.onJoinError?.(String(msg.message || 'Update THETA172 to join this class.'));
      this._ended();
      return;
    }
    if (link === this.active) this.channel?.receive(msg);
  }

  _activate(link) {
    const previous = this.active;
    if (previous && previous !== link) this.channel.linkDown();
    this.active = link;
    this.via = link.via;
    this.channel.linkUp();
    this.connected = true;
    // Keep a single route: on the local network the relay is not needed (but keep the code)
    if (link.via === 'lan' && this.relay) { this.relay.stop(); this.relay = null; }
    if (!this.everConnected) {
      this.everConnected = true;
      this.onConnected?.({ ...this.teacherInfo, via: this.via, code: this.code });
    }
    this._status('connected');
  }

  _linkLost(link) {
    if (this.active !== link) return;
    this.active = null;
    this.connected = false;
    this.channel?.linkDown();
    if (!this.discovering) return;
    this._status('reconnecting');
    // The other route, if there is one
    if (link.via === 'lan' && this.code && this.relayUrl && !this.relay) this._startRelay();
    // (the relay link reconnects by itself; the local link comes back with the next broadcast)
  }

  _armGiveUp() {
    clearTimeout(this.giveUpTimer);
    this.giveUpTimer = setTimeout(() => { if (this.discovering && this.everConnected && !this.connected) this._ended(); }, GIVE_UP_MS);
  }

  _ended() {
    if (!this.discovering) return;
    const was = this.everConnected;
    this.connected = false;
    this.stopDiscovery();
    if (was) this.onSessionEnd?.();
    this.onDisconnected?.();
  }

  _status(state) {
    this.onLinkStatus?.({ state, via: this.via, code: this.code, teacher: this.teacherInfo?.teacher || null });
  }

  _handleMessage(msg) {
    switch (msg?.type) {
      case 'code-sync': this.onCodeSync?.(msg); break;
      case 'code-change': this.onCodeChange?.(msg); break;
      case 'view-request': this.onViewRequest?.(); break;
      case 'edit-request': this.onEditRequest?.(); break;
      case 'edit-code': this.onEditCode?.(msg); break;
      case 'edit-live': this.onEditLive?.(msg); break;
      case 'session-end': this._ended(); break;
      case 'terminal': this.onTerminal?.(msg); break;
      case 'cursor': this.onCursor?.(msg); break;
      case 'selection': this.onSelection?.(msg); break;
      case 'chat-message': this.onChatMessage?.(msg); break;
      default:
        if (typeof msg?.type === 'string' && /^[a-z][a-z-]{1,40}$/.test(msg.type)) this.onClassEvent?.(msg);
    }
  }
}

module.exports = { ClassroomDiscovery, normalizeCode };

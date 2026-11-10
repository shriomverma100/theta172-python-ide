/**
 * THETA172 — Classroom links through the internet relay (relay-server/).
 *
 * The teacher and students each open an outbound WebSocket to the relay,
 * so a class works across different Wi-Fi networks, mobile hotspots and
 * home connections with no port forwarding. Both links reconnect by
 * themselves (with backoff) and resume their place in the class: the
 * relay keeps the class for a minute while the teacher is away and a
 * student's seat while they reconnect.
 */

'use strict';

const WebSocket = require('ws');
const { backoff } = require('./classroom-channel.cjs');

const DEAD_AFTER_MS = 70_000;   // the relay pings every 25 s; silence this long means the link is dead
const OPEN_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD = 1024 * 1024;

/** A relay URL the app may use: ws:// or wss:// with a host. */
function validRelayUrl(url) {
  if (typeof url !== 'string' || url.length > 300) return false;
  try {
    const u = new URL(url);
    return (u.protocol === 'wss:' || u.protocol === 'ws:') && !!u.hostname;
  } catch (_) {
    return false;
  }
}

/**
 * The address of one relay path. The Node relay accepts any path; on
 * Cloudflare /host makes a new class and /room/CODE reaches an existing one.
 */
function relayPath(base, tail) {
  const u = new URL(base);
  u.pathname = u.pathname.replace(/\/+$/, '') + tail;
  return u.toString();
}

/** "K7M-4QX @ theta172-relay.asha.workers.dev" → { code: 'K7M4QX', relayUrl: 'wss://…' } (null if it is not an invite). */
function parseInvite(text) {
  if (typeof text !== 'string' || text.length > 400) return null;
  const m = text.trim().match(/^([A-Za-z0-9]{3}[\s-]?[A-Za-z0-9]{3})\s*@\s*(\S+)$/);
  if (!m) return null;
  const code = m[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
  let host = m[2].replace(/\/+$/, '');
  if (!/^wss?:\/\//i.test(host)) host = `wss://${host}`;
  return validRelayUrl(host) ? { code, relayUrl: host } : null;
}

/** The short text a teacher shares: "K7M-4QX @ host" (just the code when there is no relay). */
function inviteText(code, relayUrl) {
  if (!code) return '';
  const pretty = `${code.slice(0, 3)}-${code.slice(3)}`;
  if (!validRelayUrl(relayUrl)) return pretty;
  const u = new URL(relayUrl);
  const where = u.protocol === 'wss:' ? u.host + u.pathname.replace(/\/+$/, '') : relayUrl.replace(/\/+$/, '');
  return `${pretty} @ ${where}`;
}

/**
 * One WebSocket to the relay that keeps coming back.
 * Subclasses handle the relay protocol in _onOpen / _onRelay.
 */
class RelayLink {
  constructor({ url, WebSocketImpl = WebSocket }) {
    this.url = url;
    this.WS = WebSocketImpl;
    this.ws = null;
    this.stopped = true;
    this.attempt = 0;
    this.retryTimer = null;
    this.deadTimer = null;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.deadTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(1000, 'bye'); } catch (_) { /* gone */ } }
  }

  /** Drop the current socket and reconnect (used when the link looks dead). */
  restart() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.terminate(); } catch (_) { /* gone */ } }
    this._closed();
  }

  get open() { return !!this.ws && this.ws.readyState === this.WS.OPEN; }

  _raw(obj) {
    if (!this.open) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
  }

  _alive() {
    clearTimeout(this.deadTimer);
    this.deadTimer = setTimeout(() => this.restart(), DEAD_AFTER_MS);
  }

  _connect() {
    if (this.stopped) return;
    let ws;
    try {
      ws = new this.WS(this._address(), { maxPayload: MAX_PAYLOAD, handshakeTimeout: OPEN_TIMEOUT_MS });
    } catch (err) {
      this._failed(err);
      return;
    }
    this.ws = ws;
    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this._alive();
      this._onOpen();
    });
    ws.on('ping', () => { if (this.ws === ws) this._alive(); });
    ws.on('message', (raw) => {
      if (this.ws !== ws) return;
      this._alive();
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      this._onRelay(msg);
    });
    ws.on('close', () => { if (this.ws === ws) { this.ws = null; this._closed(); } });
    ws.on('error', (err) => { if (this.ws === ws && ws.readyState !== this.WS.OPEN) this._lastError = err; });
  }

  _closed() {
    clearTimeout(this.deadTimer);
    this._onDown();
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this._connect(), backoff(this.attempt++));
  }

  _failed(err) {
    this._lastError = err;
    this._closed();
  }

  // Overridden
  _address() { return this.url; }
  _onOpen() {}
  _onRelay() {}
  _onDown() {}
}

/**
 * The teacher's side: hosts the class and gets the join code.
 * Events: onStatus({ state: 'connecting'|'online'|'reconnecting', code }),
 * onPeerJoin(peerId), onPeerLeave(peerId), onPeerData(peerId, text), onError(message).
 */
class RelayHost extends RelayLink {
  constructor({ url, name, WebSocketImpl, onStatus, onPeerJoin, onPeerLeave, onPeerData, onError }) {
    super({ url, WebSocketImpl });
    Object.assign(this, { name, onStatus, onPeerJoin, onPeerLeave, onPeerData, onError });
    this.code = null;
    this.token = null;
    this.peers = new Set();
  }

  start() {
    this.onStatus?.({ state: 'connecting', code: null });
    super.start();
  }

  /** End the class on the relay (students there are told it is over). */
  close() {
    this._raw({ t: 'close' });
    this.stop();
  }

  sendTo(peerId, text) { return this._raw({ t: 'send', to: peerId, data: text }); }

  _address() { return relayPath(this.url, this.code ? `/room/${this.code}` : '/host'); }

  _onOpen() {
    if (this.code && this.token) this._raw({ t: 'resume-host', code: this.code, token: this.token });
    else this._raw({ t: 'host', name: this.name });
  }

  _onRelay(msg) {
    switch (msg.t) {
      case 'hosted':
        if (typeof msg.code !== 'string' || typeof msg.token !== 'string') return;
        this.code = msg.code;
        this.token = msg.token;
        this.onStatus?.({ state: 'online', code: this.code, resumed: !!msg.resumed });
        break;
      case 'peer-join':
        if (typeof msg.id === 'string') { this.peers.add(msg.id); this.onPeerJoin?.(msg.id); }
        break;
      case 'peer-leave':
        if (typeof msg.id === 'string') { this.peers.delete(msg.id); this.onPeerLeave?.(msg.id); }
        break;
      case 'msg':
        if (typeof msg.from === 'string' && typeof msg.data === 'string') this.onPeerData?.(msg.from, msg.data);
        break;
      case 'error':
        if (msg.code === 'TAKEN') { this.restart(); break; } // a new code clashed (Cloudflare): ask again
        if (msg.code === 'ROOM_GONE') {
          // Away too long: the old class is gone, so host a new one (students get the new code)
          this.code = null;
          this.token = null;
          this._raw({ t: 'host', name: this.name });
        } else {
          this.onError?.(String(msg.message || msg.code || 'Relay error'));
        }
        break;
      default:
    }
  }

  _onDown() {
    for (const id of this.peers) this.onPeerLeave?.(id);
    this.peers.clear();
    if (!this.stopped) this.onStatus?.({ state: 'reconnecting', code: this.code });
  }
}

/**
 * A student's side: joins with the code and keeps the seat across drops.
 * Events: onReady() (joined; send the hello), onData(text), onDown(),
 * onHostAway(), onHostBack(), onEnded(), onError(code, message).
 */
class RelayJoin extends RelayLink {
  constructor({ url, code, WebSocketImpl, onReady, onData, onDown, onHostAway, onHostBack, onEnded, onError }) {
    super({ url, WebSocketImpl });
    Object.assign(this, { code, onReady, onData, onHostAway, onHostBack, onEnded, onError });
    this._onDownCb = onDown;
    this.seat = null; // { studentId, token }
    this.joined = false;
  }

  send(text) { return this.joined && this._raw({ t: 'send', data: text }); }

  _address() { return relayPath(this.url, `/room/${String(this.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`); }

  /** Leave for good (frees the seat at once). */
  leave() {
    this._raw({ t: 'leave' });
    this.stop();
  }

  _onOpen() {
    if (this.seat) this._raw({ t: 'resume-join', code: this.code, studentId: this.seat.studentId, token: this.seat.token });
    else this._raw({ t: 'join', code: this.code });
  }

  _onRelay(msg) {
    switch (msg.t) {
      case 'joined':
        this.seat = { studentId: msg.studentId, token: msg.token };
        this.joined = true;
        this.teacher = typeof msg.teacher === 'string' ? msg.teacher : '';
        this.onReady?.({ teacher: this.teacher, hostOnline: msg.hostOnline !== false });
        break;
      case 'msg':
        if (typeof msg.data === 'string') this.onData?.(msg.data);
        break;
      case 'host-away': this.onHostAway?.(); break;
      case 'host-back': this.onHostBack?.(); break;
      case 'ended':
        this.stop();
        this.onEnded?.();
        break;
      case 'error':
        if (msg.code === 'SEAT_GONE') {
          // Away longer than the relay keeps a seat: take a new one (the teacher knows us by our id)
          this.seat = null;
          this._raw({ t: 'join', code: this.code });
        } else {
          this.onError?.(String(msg.code || 'ERROR'), String(msg.message || 'Relay error'));
        }
        break;
      default:
    }
  }

  _onDown() {
    const was = this.joined;
    this.joined = false;
    if (was) this._onDownCb?.();
  }
}

module.exports = { RelayHost, RelayJoin, validRelayUrl, relayPath, parseInvite, inviteText };

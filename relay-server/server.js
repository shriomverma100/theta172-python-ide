/**
 * THETA172 — Classroom Relay Server
 *
 * Lets a teacher and students connect with a short join code from ANY
 * network (different Wi-Fi, LAN, mobile hotspot). Both sides open an
 * outbound WebSocket to this server, so no port forwarding is needed.
 *
 * The relay only routes messages. Classroom payloads travel as opaque
 * strings in `data` and are never parsed here.
 *
 * Protocol (JSON, field `t` = type):
 *   teacher → relay   { t:'host', name }                     → { t:'hosted', code, token }
 *                     { t:'resume-host', code, token }       → { t:'hosted', code, token, resumed:true }
 *                     { t:'send', to:'<studentId>'|'*', data }
 *                     { t:'close' }                          (ends the class)
 *   student → relay   { t:'join', code }                     → { t:'joined', teacher, studentId, token }
 *                     { t:'resume-join', code, studentId, token }
 *                     { t:'send', data }                     (always goes to the teacher)
 *   relay → teacher   { t:'peer-join', id } · { t:'peer-leave', id } · { t:'msg', from, data }
 *   relay → student   { t:'msg', data } · { t:'host-away' } · { t:'host-back' } · { t:'ended' }
 *   relay → anyone    { t:'error', code, message }
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

// ── Config ────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 8787;
const MAX_PAYLOAD = 1024 * 1024;           // 1 MB per message
const MAX_STUDENTS_PER_ROOM = 200;
const MAX_ROOMS = 5000;
const HOST_GRACE_MS = 60_000;              // keep the class alive while the teacher reconnects
const STUDENT_GRACE_MS = 45_000;           // keep a student's seat while they reconnect (same as the teacher app)
const HEARTBEAT_MS = 25_000;               // keeps proxies/NATs from dropping idle sockets
const JOIN_FAILS_PER_MIN = 20;             // wrong-code guesses allowed per IP per minute
const HOSTS_PER_MIN = 10;                  // classes created per IP per minute
const MSG_RATE = 150;                      // messages per second per socket (token bucket)

// No 0/O/1/I/L: codes are read aloud and copied from a projector.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

// ── State ─────────────────────────────────────────────────────────
/** @type {Map<string, Room>} */
const rooms = new Map();
const ipCounters = new Map(); // `${kind}:${ip}` -> { count, windowStart }

/**
 * @typedef {{ ws: WebSocket|null, token: string, graceTimer: NodeJS.Timeout|null }} Seat
 * @typedef {{ code: string, teacherName: string, hostToken: string, host: WebSocket|null,
 *             hostGraceTimer: NodeJS.Timeout|null, students: Map<string, Seat>, nextId: number }} Room
 */

// ── Helpers ───────────────────────────────────────────────────────
const newToken = () => crypto.randomBytes(18).toString('base64url');

function newCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

/** Accepts "k7m 4qx", "K7M-4QX", etc. */
function normalizeCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function cleanName(raw) {
  if (typeof raw !== 'string') return 'Teacher';
  const s = raw.replace(/[\x00-\x1F\x7F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);
  return s || 'Teacher';
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Fixed-window counter per IP. Returns false once the limit is exceeded. */
function allow(kind, ip, limit) {
  const key = `${kind}:${ip}`;
  const now = Date.now();
  let entry = ipCounters.get(key);
  if (!entry || now - entry.windowStart > 60_000) {
    entry = { count: 0, windowStart: now };
    ipCounters.set(key, entry);
  }
  entry.count++;
  return entry.count <= limit;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }
}

function fail(ws, code, message) {
  send(ws, { t: 'error', code, message });
}

function clientIp(req) {
  // Behind Render/Railway/Fly the real client IP is in X-Forwarded-For.
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ── Room lifecycle ────────────────────────────────────────────────
function endRoom(room) {
  if (!rooms.has(room.code)) return;
  rooms.delete(room.code);
  clearTimeout(room.hostGraceTimer);
  for (const seat of room.students.values()) {
    clearTimeout(seat.graceTimer);
    if (seat.ws) {
      send(seat.ws, { t: 'ended' });
      seat.ws.role = null;
      try { seat.ws.close(1000, 'class ended'); } catch (_) {}
    }
  }
  room.students.clear();
  if (room.host) {
    room.host.role = null;
    try { room.host.close(1000, 'class ended'); } catch (_) {}
  }
}

function broadcastToStudents(room, obj) {
  const payload = JSON.stringify(obj);
  for (const seat of room.students.values()) {
    if (seat.ws && seat.ws.readyState === WebSocket.OPEN) {
      try { seat.ws.send(payload); } catch (_) {}
    }
  }
}

function attachHost(room, ws) {
  if (room.host && room.host !== ws) {
    room.host.role = null; // old socket must not tear the room down when it closes
    try { room.host.close(4000, 'replaced'); } catch (_) {}
  }
  clearTimeout(room.hostGraceTimer);
  room.hostGraceTimer = null;
  room.host = ws;
  ws.role = 'host';
  ws.room = room;
}

function attachStudent(room, id, seat, ws) {
  if (seat.ws && seat.ws !== ws) {
    seat.ws.role = null;
    try { seat.ws.close(4000, 'replaced'); } catch (_) {}
  }
  clearTimeout(seat.graceTimer);
  seat.graceTimer = null;
  seat.ws = ws;
  ws.role = 'student';
  ws.room = room;
  ws.studentId = id;
}

// ── Message handling ──────────────────────────────────────────────
function handle(ws, msg) {
  if (!msg || typeof msg.t !== 'string') return;

  // Unattached sockets may only host/join/resume.
  if (!ws.role) {
    switch (msg.t) {
      case 'host': {
        if (!allow('host', ws.ip, HOSTS_PER_MIN)) return fail(ws, 'RATE_LIMIT', 'Too many classes created. Wait a minute.');
        if (rooms.size >= MAX_ROOMS) return fail(ws, 'FULL', 'Server is at capacity. Try again later.');
        const code = newCode();
        if (!code) return fail(ws, 'FULL', 'Could not allocate a join code.');
        const room = {
          code, teacherName: cleanName(msg.name), hostToken: newToken(),
          host: null, hostGraceTimer: null, students: new Map(), nextId: 1,
        };
        rooms.set(code, room);
        attachHost(room, ws);
        return send(ws, { t: 'hosted', code, token: room.hostToken });
      }

      case 'resume-host': {
        const room = rooms.get(normalizeCode(msg.code));
        if (!room || !safeEqual(msg.token, room.hostToken)) return fail(ws, 'ROOM_GONE', 'This class has ended.');
        attachHost(room, ws);
        send(ws, { t: 'hosted', code: room.code, token: room.hostToken, resumed: true });
        // Re-announce present students so the teacher's list is rebuilt.
        for (const [id, seat] of room.students) if (seat.ws) send(ws, { t: 'peer-join', id });
        return broadcastToStudents(room, { t: 'host-back' });
      }

      case 'join': {
        const code = normalizeCode(msg.code);
        const room = rooms.get(code);
        if (!room) {
          if (!allow('joinfail', ws.ip, JOIN_FAILS_PER_MIN)) {
            return fail(ws, 'RATE_LIMIT', 'Too many wrong codes. Wait a minute and try again.');
          }
          return fail(ws, 'BAD_CODE', 'No class found with that code.');
        }
        if (room.students.size >= MAX_STUDENTS_PER_ROOM) return fail(ws, 'FULL', 'This class is full.');
        const id = `s${room.nextId++}`;
        const seat = { ws: null, token: newToken(), graceTimer: null };
        room.students.set(id, seat);
        attachStudent(room, id, seat, ws);
        send(ws, { t: 'joined', teacher: room.teacherName, studentId: id, token: seat.token, hostOnline: !!room.host });
        return send(room.host, { t: 'peer-join', id });
      }

      case 'resume-join': {
        const room = rooms.get(normalizeCode(msg.code));
        const seat = room?.students.get(msg.studentId);
        if (!room || !seat || !safeEqual(msg.token, seat.token)) {
          return fail(ws, 'SEAT_GONE', 'Session expired. Join again.');
        }
        const wasAway = !seat.ws;
        attachStudent(room, msg.studentId, seat, ws);
        send(ws, { t: 'joined', teacher: room.teacherName, studentId: msg.studentId, token: seat.token, hostOnline: !!room.host, resumed: true });
        if (wasAway) send(room.host, { t: 'peer-join', id: msg.studentId });
        return;
      }

      default:
        return fail(ws, 'NOT_JOINED', 'Host or join a class first.');
    }
  }

  const room = ws.room;
  if (!room || !rooms.has(room.code)) return;

  if (ws.role === 'host') {
    if (msg.t === 'close') return endRoom(room);
    if (msg.t !== 'send' || typeof msg.data !== 'string') return;
    if (msg.to === '*') return broadcastToStudents(room, { t: 'msg', data: msg.data });
    const seat = room.students.get(msg.to);
    if (seat?.ws) send(seat.ws, { t: 'msg', data: msg.data });
    return;
  }

  if (ws.role === 'student') {
    if (msg.t === 'leave') {
      // Explicit disconnect: free the seat immediately.
      room.students.delete(ws.studentId);
      ws.role = null;
      send(room.host, { t: 'peer-leave', id: ws.studentId });
      try { ws.close(1000, 'left'); } catch (_) {}
      return;
    }
    if (msg.t !== 'send' || typeof msg.data !== 'string') return;
    send(room.host, { t: 'msg', from: ws.studentId, data: msg.data });
  }
}

function onClose(ws) {
  const room = ws.room;
  if (!room || !rooms.has(room.code)) return;

  if (ws.role === 'host' && room.host === ws) {
    room.host = null;
    broadcastToStudents(room, { t: 'host-away' });
    room.hostGraceTimer = setTimeout(() => endRoom(room), HOST_GRACE_MS);
    return;
  }

  if (ws.role === 'student') {
    const id = ws.studentId;
    const seat = room.students.get(id);
    if (!seat || seat.ws !== ws) return;
    seat.ws = null;
    send(room.host, { t: 'peer-leave', id });
    seat.graceTimer = setTimeout(() => room.students.delete(id), STUDENT_GRACE_MS);
  }
}

// ── Server ────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('THETA172 classroom relay\n');
});

const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

wss.on('connection', (ws, req) => {
  ws.ip = clientIp(req);
  ws.role = null;
  ws.isAlive = true;
  ws.tokens = MSG_RATE;
  ws.lastRefill = Date.now();

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;

    // Token bucket: drop floods instead of disconnecting (live typing is bursty).
    const now = Date.now();
    ws.tokens = Math.min(MSG_RATE, ws.tokens + ((now - ws.lastRefill) / 1000) * MSG_RATE);
    ws.lastRefill = now;
    if (ws.tokens < 1) return;
    ws.tokens -= 1;

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    handle(ws, msg);
  });

  ws.on('close', () => onClose(ws));
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
  // Drop old rate-limit windows.
  const cutoff = Date.now() - 120_000;
  for (const [key, entry] of ipCounters) if (entry.windowStart < cutoff) ipCounters.delete(key);
}, HEARTBEAT_MS);

heartbeat.unref?.();
wss.on('close', () => clearInterval(heartbeat));

/** Start listening (tests pass 0 for any free port). Resolves with the port. */
function listen(port = PORT) {
  return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
}

if (require.main === module) {
  listen().then((p) => console.log(`[relay] listening on :${p}`));
}

module.exports = { server, wss, rooms, listen };

/**
 * THETA172 — classroom relay core.
 *
 * The rules of the internet relay, independent of where it runs: in Node
 * (the Docker relay, the campus relay inside the app) and on Cloudflare
 * Workers (one Durable Object per class). Plain JavaScript with no imports:
 * the Cloudflare deploy pastes this file in front of the Worker wrapper.
 *
 * Protocol (JSON, field `t` = type):
 *   teacher → relay   { t:'host', name }                     → { t:'hosted', code, token }
 *                     { t:'resume-host', code, token }       → { t:'hosted', code, token, resumed:true }
 *                     { t:'send', to:'<studentId>'|'*', data }
 *                     { t:'close' }                          (ends the class)
 *   student → relay   { t:'join', code }                     → { t:'joined', teacher, studentId, token }
 *                     { t:'resume-join', code, studentId, token }
 *                     { t:'send', data }                     (always goes to the teacher)
 *                     { t:'leave' }
 *   relay → teacher   { t:'peer-join', id } · { t:'peer-leave', id } · { t:'msg', from, data }
 *   relay → student   { t:'msg', data } · { t:'host-away' } · { t:'host-back' } · { t:'ended' }
 *   relay → anyone    { t:'error', code, message } · { t:'ping' } (keep-alive, ignore it)
 *
 * A socket here is anything with send(text), close(code, reason) and an
 * `ip` string; the core keeps its own fields on it (role, room, …).
 */

var RELAY_LIMITS = {
  MAX_PAYLOAD: 1024 * 1024,      // 1 MB per message
  MAX_STUDENTS_PER_ROOM: 200,
  MAX_ROOMS: 5000,
  HOST_GRACE_MS: 60000,          // keep the class while the teacher reconnects
  STUDENT_GRACE_MS: 45000,       // keep a student's seat while they reconnect
  JOIN_FAILS_PER_MIN: 20,        // wrong-code guesses per IP per minute
  HOSTS_PER_MIN: 10,             // classes created per IP per minute
  MSG_RATE: 150,                 // messages per second per socket (token bucket)
};

// No 0/O/1/I/L: codes are read aloud and copied from a projector
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var CODE_LENGTH = 6;

function relayRandomBytes(n) {
  var a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

function relayToken() {
  var b = relayRandomBytes(18);
  var s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function relayNewCode(exists) {
  for (var attempt = 0; attempt < 20; attempt++) {
    var b = relayRandomBytes(CODE_LENGTH);
    var code = '';
    for (var i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
    if (!exists(code)) return code;
  }
  return null;
}

/** "k7m 4qx", "K7M-4QX" … → "K7M4QX" */
function relayNormalizeCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function relayCleanName(raw) {
  if (typeof raw !== 'string') return 'Teacher';
  var s = raw.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);
  return s || 'Teacher';
}

/** Comparison that takes the same time whatever the input (tokens). */
function relaySafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The relay. One instance holds many classes (Node) or exactly one (a
 * Durable Object passes `fixedCode`, the class code it was created for).
 * @param {{ fixedCode?: string, now?: () => number, setTimer?: Function, clearTimer?: Function }} [opts]
 */
function createRelay(opts) {
  opts = opts || {};
  var now = opts.now || function () { return Date.now(); };
  var setTimer = opts.setTimer || function (fn, ms) { return setTimeout(fn, ms); };
  var clearTimer = opts.clearTimer || function (t) { clearTimeout(t); };
  var rooms = new Map();
  var ipCounters = new Map();

  function send(ws, obj) {
    if (!ws || ws.closed) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* gone */ }
  }
  function fail(ws, code, message) { send(ws, { t: 'error', code: code, message: message }); }
  function allow(kind, ip, limit) {
    var key = kind + ':' + ip;
    var t = now();
    var e = ipCounters.get(key);
    if (!e || t - e.windowStart > 60000) { e = { count: 0, windowStart: t }; ipCounters.set(key, e); }
    e.count++;
    return e.count <= limit;
  }

  function endRoom(room) {
    if (!rooms.has(room.code)) return;
    rooms.delete(room.code);
    clearTimer(room.hostGraceTimer);
    room.students.forEach(function (seat) {
      clearTimer(seat.graceTimer);
      if (seat.ws) {
        send(seat.ws, { t: 'ended' });
        seat.ws.role = null;
        try { seat.ws.close(1000, 'class ended'); } catch (_) { /* gone */ }
      }
    });
    room.students.clear();
    if (room.host) {
      room.host.role = null;
      try { room.host.close(1000, 'class ended'); } catch (_) { /* gone */ }
    }
  }

  function toStudents(room, obj) {
    var payload = JSON.stringify(obj);
    room.students.forEach(function (seat) {
      if (seat.ws && !seat.ws.closed) { try { seat.ws.send(payload); } catch (_) { /* gone */ } }
    });
  }

  function attachHost(room, ws) {
    if (room.host && room.host !== ws) {
      room.host.role = null; // the old socket must not end the class when it closes
      try { room.host.close(4000, 'replaced'); } catch (_) { /* gone */ }
    }
    clearTimer(room.hostGraceTimer);
    room.hostGraceTimer = null;
    room.host = ws;
    ws.role = 'host';
    ws.room = room;
  }

  function attachStudent(room, id, seat, ws) {
    if (seat.ws && seat.ws !== ws) {
      seat.ws.role = null;
      try { seat.ws.close(4000, 'replaced'); } catch (_) { /* gone */ }
    }
    clearTimer(seat.graceTimer);
    seat.graceTimer = null;
    seat.ws = ws;
    ws.role = 'student';
    ws.room = room;
    ws.studentId = id;
  }

  function newRoomCode() {
    if (opts.fixedCode) return rooms.has(opts.fixedCode) ? null : opts.fixedCode;
    return relayNewCode(function (c) { return rooms.has(c); });
  }

  /** A message from a socket. */
  function message(ws, raw) {
    if (typeof raw !== 'string' || raw.length > RELAY_LIMITS.MAX_PAYLOAD) return;
    // Token bucket: floods are dropped, not disconnected (live typing is bursty)
    var t = now();
    if (ws.tokens === undefined) { ws.tokens = RELAY_LIMITS.MSG_RATE; ws.lastRefill = t; }
    ws.tokens = Math.min(RELAY_LIMITS.MSG_RATE, ws.tokens + ((t - ws.lastRefill) / 1000) * RELAY_LIMITS.MSG_RATE);
    ws.lastRefill = t;
    if (ws.tokens < 1) return;
    ws.tokens -= 1;
    var msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!ws.role) {
      var room;
      switch (msg.t) {
        case 'host': {
          if (!allow('host', ws.ip, RELAY_LIMITS.HOSTS_PER_MIN)) return fail(ws, 'RATE_LIMIT', 'Too many classes created. Wait a minute.');
          if (rooms.size >= RELAY_LIMITS.MAX_ROOMS) return fail(ws, 'FULL', 'The server is at capacity. Try again later.');
          var code = newRoomCode();
          if (!code) return fail(ws, 'TAKEN', 'Could not make a join code. Try again.');
          room = { code: code, teacherName: relayCleanName(msg.name), hostToken: relayToken(), host: null, hostGraceTimer: null, students: new Map(), nextId: 1 };
          rooms.set(code, room);
          attachHost(room, ws);
          return send(ws, { t: 'hosted', code: code, token: room.hostToken });
        }
        case 'resume-host': {
          room = rooms.get(relayNormalizeCode(msg.code));
          if (!room || !relaySafeEqual(msg.token, room.hostToken)) return fail(ws, 'ROOM_GONE', 'This class has ended.');
          attachHost(room, ws);
          send(ws, { t: 'hosted', code: room.code, token: room.hostToken, resumed: true });
          room.students.forEach(function (seat, id) { if (seat.ws) send(ws, { t: 'peer-join', id: id }); });
          return toStudents(room, { t: 'host-back' });
        }
        case 'join': {
          room = rooms.get(relayNormalizeCode(msg.code));
          if (!room) {
            if (!allow('joinfail', ws.ip, RELAY_LIMITS.JOIN_FAILS_PER_MIN)) return fail(ws, 'RATE_LIMIT', 'Too many wrong codes. Wait a minute and try again.');
            return fail(ws, 'BAD_CODE', 'No class found with that code.');
          }
          if (room.students.size >= RELAY_LIMITS.MAX_STUDENTS_PER_ROOM) return fail(ws, 'FULL', 'This class is full.');
          var id = 's' + room.nextId++;
          var seat = { ws: null, token: relayToken(), graceTimer: null };
          room.students.set(id, seat);
          attachStudent(room, id, seat, ws);
          send(ws, { t: 'joined', teacher: room.teacherName, studentId: id, token: seat.token, hostOnline: !!room.host });
          return send(room.host, { t: 'peer-join', id: id });
        }
        case 'resume-join': {
          room = rooms.get(relayNormalizeCode(msg.code));
          var s = room && room.students.get(msg.studentId);
          if (!room || !s || !relaySafeEqual(msg.token, s.token)) return fail(ws, 'SEAT_GONE', 'Session expired. Join again.');
          var wasAway = !s.ws;
          attachStudent(room, msg.studentId, s, ws);
          send(ws, { t: 'joined', teacher: room.teacherName, studentId: msg.studentId, token: s.token, hostOnline: !!room.host, resumed: true });
          if (wasAway) send(room.host, { t: 'peer-join', id: msg.studentId });
          return undefined;
        }
        default:
          return fail(ws, 'NOT_JOINED', 'Host or join a class first.');
      }
    }

    var r = ws.room;
    if (!r || !rooms.has(r.code)) return;
    if (ws.role === 'host') {
      if (msg.t === 'close') return endRoom(r);
      if (msg.t !== 'send' || typeof msg.data !== 'string') return;
      if (msg.to === '*') return toStudents(r, { t: 'msg', data: msg.data });
      var target = r.students.get(msg.to);
      if (target && target.ws) send(target.ws, { t: 'msg', data: msg.data });
      return;
    }
    if (ws.role === 'student') {
      if (msg.t === 'leave') {
        r.students.delete(ws.studentId);
        ws.role = null;
        send(r.host, { t: 'peer-leave', id: ws.studentId });
        try { ws.close(1000, 'left'); } catch (_) { /* gone */ }
        return;
      }
      if (msg.t !== 'send' || typeof msg.data !== 'string') return;
      send(r.host, { t: 'msg', from: ws.studentId, data: msg.data });
    }
  }

  /** A socket closed. */
  function closed(ws) {
    ws.closed = true;
    var room = ws.room;
    if (!room || !rooms.has(room.code)) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
      toStudents(room, { t: 'host-away' });
      room.hostGraceTimer = setTimer(function () { endRoom(room); }, RELAY_LIMITS.HOST_GRACE_MS);
      return;
    }
    if (ws.role === 'student') {
      var id = ws.studentId;
      var seat = room.students.get(id);
      if (!seat || seat.ws !== ws) return;
      seat.ws = null;
      send(room.host, { t: 'peer-leave', id: id });
      seat.graceTimer = setTimer(function () { room.students.delete(id); }, RELAY_LIMITS.STUDENT_GRACE_MS);
    }
  }

  /** Forget old rate-limit windows (call now and then). */
  function sweep() {
    var cutoff = now() - 120000;
    ipCounters.forEach(function (e, k) { if (e.windowStart < cutoff) ipCounters.delete(k); });
  }

  return { message: message, closed: closed, sweep: sweep, rooms: rooms, endRoom: endRoom };
}

/* Node: module.exports. On Cloudflare this file is pasted into the Worker module, where `module` does not exist. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createRelay: createRelay, relayNormalizeCode: relayNormalizeCode, RELAY_LIMITS: RELAY_LIMITS, CODE_ALPHABET: CODE_ALPHABET };
}

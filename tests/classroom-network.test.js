import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ReliableChannel, backoff } = require('../electron/classroom-channel.cjs');
const { ClassroomServer, PROTOCOL } = require('../electron/classroom-server.cjs');
const { ClassroomDiscovery, normalizeCode } = require('../electron/classroom-discovery.cjs');
const { validRelayUrl } = require('../electron/classroom-relay.cjs');
const relayServer = require('../relay-server/server.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Two channels joined by a wire that can be cut. */
function pair() {
  const wire = { up: true };
  const got = { a: [], b: [] };
  const a = new ReliableChannel({ transmit: (f) => wire.up && (b.receive(structuredClone(f)), true), deliver: (m) => got.a.push(m) });
  const b = new ReliableChannel({ transmit: (f) => wire.up && (a.receive(structuredClone(f)), true), deliver: (m) => got.b.push(m) });
  return { a, b, got, wire };
}

describe('reliable delivery', () => {
  it('delivers in order and keeps messages until acknowledged', async () => {
    const { a, b, got } = pair();
    a.linkUp(); b.linkUp();
    a.send({ n: 1 }); a.send({ n: 2 });
    expect(got.b).toEqual([{ n: 1 }, { n: 2 }]);
    expect(a.pending).toBe(2);
    await sleep(250); // acknowledgements are batched
    expect(a.pending).toBe(0);
  });

  it('keeps what is sent during an outage and resends it after reconnecting, once', async () => {
    const { a, b, got, wire } = pair();
    a.linkUp(); b.linkUp();
    a.send({ n: 1 });
    wire.up = false; a.linkDown(); b.linkDown();
    a.send({ n: 2 }); a.send({ n: 3 }); b.send({ from: 'b' });
    expect(got.b).toEqual([{ n: 1 }]);
    wire.up = true;
    a.linkUp(); b.linkUp();
    expect(got.b).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(got.a).toEqual([{ from: 'b' }]);
    // A second reconnect does not deliver anything twice
    a.linkDown(); b.linkDown(); a.linkUp(); b.linkUp();
    expect(got.b).toHaveLength(3);
  });

  it('resends only the newest copy of "latest wins" messages', () => {
    const { a, b, got, wire } = pair();
    wire.up = false;
    for (let i = 0; i < 50; i++) a.send({ code: `v${i}` }, { key: 'code' });
    a.send({ chat: 'hi' });
    wire.up = true;
    a.linkUp(); b.linkUp();
    expect(got.b).toEqual([{ code: 'v49' }, { chat: 'hi' }]);
  });

  it('starts numbering again when the other side restarts', () => {
    const { a, b, got } = pair();
    a.linkUp(); b.linkUp();
    a.send({ n: 1 }); a.send({ n: 2 });
    // b's partner restarts: a new channel that will reuse sequence numbers 1, 2, …
    const fresh = new ReliableChannel({ transmit: (f) => (b.receive(structuredClone(f)), true), deliver: () => {} });
    fresh.linkUp();
    fresh.send({ again: 1 });
    expect(got.b.at(-1)).toEqual({ again: 1 });
  });

  it('backs off with jitter up to a ceiling', () => {
    expect(backoff(0)).toBeLessThan(600);
    for (let i = 0; i < 30; i++) expect(backoff(i)).toBeLessThanOrEqual(6000 * 1.3);
  });

  it('accepts only ws/wss relay URLs and normalises join codes', () => {
    expect(validRelayUrl('wss://relay.example.com')).toBe(true);
    expect(validRelayUrl('ws://127.0.0.1:8787')).toBe(true);
    expect(validRelayUrl('https://relay.example.com')).toBe(false);
    expect(validRelayUrl('javascript:alert(1)')).toBe(false);
    expect(normalizeCode('k7m-4qx')).toBe('K7M4QX');
  });
});

// ── A real class: relay, teacher and students on this machine ────────

let relayUrl;
beforeAll(async () => {
  const port = await relayServer.listen(0);
  relayUrl = `ws://127.0.0.1:${port}`;
});
afterAll(() => {
  for (const ws of relayServer.wss.clients) ws.terminate();
  relayServer.server.close();
});

const opened = [];
afterEach(() => {
  for (const o of opened.splice(0)) { try { o.stop?.(); o.stopDiscovery?.(); } catch (_) { /* done */ } }
});

async function startClass() {
  const teacher = new ClassroomServer({ udp: false, port: 0 });
  opened.push(teacher);
  const ev = { joins: [], leaves: [], status: [], chats: [], help: [], relay: [], events: [] };
  teacher.onStudentJoin = (i) => ev.joins.push(i);
  teacher.onStudentLeave = (i) => ev.leaves.push(i);
  teacher.onStudentStatus = (i) => ev.status.push(i);
  teacher.onChatMessage = (i) => ev.chats.push(i.text);
  teacher.onHelpRequest = (i) => ev.help.push(i);
  teacher.onRelayStatus = (s) => ev.relay.push(s);
  teacher.onStudentEvent = (who, msg) => ev.events.push(msg);
  const res = await teacher.start('Ms. Rao', { relayUrl });
  expect(res.success).toBe(true);
  const code = await waitFor(() => teacher.relayState.code, 8000, 'join code');
  return { teacher, ev, code };
}

function student(name = 'Asha') {
  const s = new ClassroomDiscovery({ udp: false });
  opened.push(s);
  const got = { codes: [], chats: [], status: [], ended: 0, errors: [], events: [] };
  s.onCodeSync = (m) => got.codes.push(m.code);
  s.onChatMessage = (m) => got.chats.push(m.text);
  s.onLinkStatus = (st) => got.status.push(st.state + ':' + st.via);
  s.onSessionEnd = () => got.ended++;
  s.onJoinError = (m) => got.errors.push(m);
  s.onClassEvent = (m) => got.events.push(m);
  s.name = name;
  return { s, got };
}

describe('a class across networks (internet relay)', () => {
  it('joins with the code and talks both ways', async () => {
    const { teacher, ev, code } = await startClass();
    const { s, got } = student();
    s.startDiscovery('Asha', '7', { code: code.toLowerCase().replace(/(...)/, '$1-'), relayUrl });
    await waitFor(() => s.connected, 8000, 'student connected');
    expect(s.via).toBe('internet');
    expect(ev.joins.map((j) => [j.name, j.via])).toEqual([['Asha', 'internet']]);
    teacher.broadcastCode('print(1)', 0, 'main.py');
    s.sendChatMessage('hello miss');
    await waitFor(() => got.codes.length && ev.chats.length, 5000, 'messages');
    expect(got.codes).toEqual(['print(1)']);
    expect(ev.chats).toEqual(['hello miss']);
  });

  it('a wrong code is reported (not retried forever)', async () => {
    await startClass();
    const { s, got } = student();
    s.startDiscovery('Asha', '7', { code: 'ZZZZZZ', relayUrl });
    await waitFor(() => got.errors.length, 5000, 'join error');
    expect(got.errors[0]).toMatch(/No class/);
    expect(s.connected).toBe(false);
  });

  it('a dropped student connection loses nothing and does not rejoin as someone new', async () => {
    const { teacher, ev, code } = await startClass();
    const { s, got } = student();
    s.startDiscovery('Asha', '7', { code, relayUrl });
    await waitFor(() => s.connected, 8000, 'connected');
    const id = ev.joins[0].id;

    // The student's network goes away
    s.relay.ws.terminate();
    await waitFor(() => !s.connected, 3000, 'drop noticed');
    teacher.sendChatMessage('one', id, 'Ms. Rao');
    teacher.sendChatMessage('two', id, 'Ms. Rao');
    teacher.broadcastCode('v1', 0, 'main.py');
    teacher.broadcastCode('v2', 0, 'main.py');
    s.sendHelpRequest('stuck on line 4', { type: 'NameError', message: "name 'x' is not defined", line: 4 });

    await waitFor(() => s.connected, 10000, 'reconnected');
    await waitFor(() => got.chats.length === 2 && ev.help.length === 1, 5000, 'resent messages');
    await sleep(300);
    expect(got.chats).toEqual(['one', 'two']);
    expect(got.codes.at(-1)).toBe('v2');
    expect(got.codes).not.toContain('v1'); // only the newest code was resent
    expect(ev.help[0].error).toEqual({ type: 'NameError', message: "name 'x' is not defined", line: 4 });
    expect(ev.joins).toHaveLength(1);
    expect(ev.leaves).toHaveLength(0);
    expect(ev.status.map((x) => x.state)).toEqual(['away', 'online']);
    expect(teacher.getStudents()).toHaveLength(1);
  }, 20000);

  it('the teacher losing the internet keeps the class and its code', async () => {
    const { teacher, ev, code } = await startClass();
    const { s, got } = student();
    s.startDiscovery('Asha', '7', { code, relayUrl });
    await waitFor(() => s.connected, 8000, 'connected');

    teacher.relay.ws.terminate();
    await sleep(100);
    teacher.broadcastCode('during outage', 0, 'main.py');
    s.sendChatMessage('are you there?');
    await waitFor(() => ev.chats.includes('are you there?') && got.codes.includes('during outage'), 12000, 'class resumed');
    expect(teacher.relayState.code).toBe(code);
    expect(ev.joins).toHaveLength(1);
  }, 20000);

  it('moves to the local network when it can, and back to the internet when that fails', async () => {
    const { teacher, ev, code } = await startClass();
    const { s, got } = student();
    s.startDiscovery('Asha', '7', { code, relayUrl });
    await waitFor(() => s.connected, 8000, 'connected');

    // The teacher's broadcast is heard: same network
    s.lanEndpoint = { ip: '127.0.0.1', port: teacher.port, seenAt: Date.now(), classId: teacher.classId };
    s._connectLan();
    await waitFor(() => s.via === 'lan', 5000, 'switched to the local network');
    await waitFor(() => !s.relay, 2000, 'relay closed');
    teacher.sendChatMessage('via lan', 'broadcast', 'Ms. Rao');
    await waitFor(() => got.chats.includes('via lan'), 5000, 'lan message');

    // The local network fails (Wi-Fi off): back through the internet
    s.lanEndpoint.seenAt = 0; // no more broadcasts
    for (const ws of teacher.wss.clients) ws.terminate();
    teacher.sendChatMessage('after switch', 'broadcast', 'Ms. Rao');
    await waitFor(() => s.via === 'internet' && s.connected, 10000, 'back on the internet');
    await waitFor(() => got.chats.includes('after switch'), 5000, 'message after switch');
    expect(got.chats.filter((c) => c === 'via lan')).toHaveLength(1);
    expect(ev.joins).toHaveLength(1);
  }, 25000);

  it('ending the class tells every student', async () => {
    const { teacher, code } = await startClass();
    const a = student('Asha');
    const b = student('Ravi');
    a.s.startDiscovery('Asha', '7', { code, relayUrl });
    b.s.startDiscovery('Ravi', '8', { code, relayUrl });
    await waitFor(() => a.s.connected && b.s.connected, 8000, 'both connected');
    teacher.stop();
    await waitFor(() => a.got.ended && b.got.ended, 5000, 'both told');
  });

  it('an older app is told to update', async () => {
    const { teacher } = await startClass();
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${teacher.port}`);
    const msgs = [];
    ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'join', name: 'Old', roll: '1' })); // no proto, no id
    await waitFor(() => msgs.length, 3000, 'reply');
    expect(msgs[0]).toMatchObject({ type: 'session-end', reason: 'update' });
    expect(teacher.getStudents()).toHaveLength(0);
    ws.close();
  });

  it('students on the local network only (no internet) still work', async () => {
    const teacher = new ClassroomServer({ udp: false, port: 0 });
    opened.push(teacher);
    const res = await teacher.start('Ms. Rao', {}); // no relay
    expect(res.success).toBe(true);
    const { s, got } = student();
    s.startDiscovery('Asha', '7', {});
    s.lanEndpoint = { ip: '127.0.0.1', port: teacher.port, seenAt: Date.now(), classId: teacher.classId };
    s._connectLan();
    await waitFor(() => s.connected, 5000, 'connected');
    teacher.broadcastCode('local only', 0, 'main.py');
    await waitFor(() => got.codes.includes('local only'), 3000, 'code');
    expect(PROTOCOL).toBe(2);
  });
});

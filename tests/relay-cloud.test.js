/**
 * The relay on Cloudflare (simulated Worker + Durable Objects), the
 * deploy steps against a fake Cloudflare API, invites, and the Node relay
 * answering on the Cloudflare paths.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

const require = createRequire(import.meta.url);
const { buildWorkerScript, CloudflareDeployer, testRelay } = require('../electron/cloudflare-deploy.cjs');
const { parseInvite, inviteText, relayPath } = require('../electron/classroom-relay.cjs');
const { createRelayServer } = require('../electron/relay-node.cjs');
const { exportRelayFolder } = require('../electron/relay-setup.cjs');

// ── A tiny Cloudflare runtime: WebSocketPair, 101 responses, Durable Object namespace ──
class FakeEnd {
  constructor() { this.listeners = {}; this.peer = null; this.closed = false; this.received = []; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, ev) { for (const fn of this.listeners[type] || []) fn(ev); }
  accept() {}
  send(text) { if (!this.closed && !this.peer.closed) this.peer.deliver(text); }
  deliver(text) { this.received.push(text); this.emit('message', { data: text }); }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.peer.closed = true;
    this.peer.emit('close', {});
    this.emit('close', {});
  }
}

let worker;
let realResponse;
const objects = new Map();
const env = {
  ROOMS: {
    idFromName: (name) => `id:${name}`,
    get: (id) => ({ fetch: (req) => {
      if (!objects.has(id)) objects.set(id, new worker.ClassRoom({ id }, env));
      return objects.get(id).fetch(req);
    } }),
  },
};

beforeAll(async () => {
  realResponse = globalThis.Response;
  globalThis.WebSocketPair = function WebSocketPair() {
    const a = new FakeEnd();
    const b = new FakeEnd();
    a.peer = b;
    b.peer = a;
    return { 0: a, 1: b };
  };
  globalThis.Response = class extends realResponse {
    constructor(body, init = {}) {
      const ws = init.webSocket;
      super(body, ws ? { ...init, status: 200 } : init);
      if (ws) { this.webSocket = ws; Object.defineProperty(this, 'status', { value: 101 }); }
    }
  };
  const file = path.join(os.tmpdir(), `theta-worker-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(file, buildWorkerScript());
  worker = await import(pathToFileURL(file).href);
  worker.default.ClassRoom = worker.ClassRoom;
  worker = { ...worker.default, ClassRoom: worker.ClassRoom };
});

afterAll(() => {
  globalThis.Response = realResponse;
  delete globalThis.WebSocketPair;
  for (const o of objects.values()) o.stopPing();
});

/** Open a WebSocket to the simulated Worker; returns the client end with helpers. */
async function connect(p) {
  const res = await worker.fetch(new Request(`https://theta172-relay.test.workers.dev${p}`, { headers: { Upgrade: 'websocket' } }), env);
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  return {
    ws,
    send: (o) => ws.send(JSON.stringify(o)),
    last: () => JSON.parse(ws.received[ws.received.length - 1]),
    all: () => ws.received.map((t) => JSON.parse(t)),
  };
}

describe('the relay on Cloudflare', () => {
  it('is one ES module with the shared rules and the Durable Object', () => {
    const src = buildWorkerScript();
    expect(src).toMatch(/function createRelay/);
    expect(src).toMatch(/export class ClassRoom/);
    expect(src).toMatch(/export default/);
    expect(src).not.toMatch(/\brequire\(/);
    expect(src).not.toMatch(/module\.exports/);
  });

  it('answers /health', async () => {
    const res = await worker.fetch(new Request('https://x.workers.dev/health'), env);
    expect(await res.json()).toMatchObject({ ok: true, relay: 'theta172' });
  });

  it('runs a class: host on /host, join on /room/CODE, messages both ways', async () => {
    const t = await connect('/host');
    t.send({ t: 'host', name: 'Ms. Rao' });
    const hosted = t.last();
    expect(hosted.t).toBe('hosted');
    expect(hosted.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(objects.has(`id:${hosted.code}`)).toBe(true);

    const s = await connect(`/room/${hosted.code.slice(0, 3)}-${hosted.code.slice(3)}`);
    s.send({ t: 'join', code: hosted.code });
    expect(s.last()).toMatchObject({ t: 'joined', teacher: 'Ms. Rao' });
    const peer = t.last();
    expect(peer.t).toBe('peer-join');

    s.send({ t: 'send', data: 'hi miss' });
    expect(t.last()).toEqual({ t: 'msg', from: peer.id, data: 'hi miss' });
    t.send({ t: 'send', to: '*', data: 'hello class' });
    expect(s.last()).toEqual({ t: 'msg', data: 'hello class' });

    // The teacher drops and comes back on /room/CODE with the token
    t.ws.close();
    expect(s.last()).toEqual({ t: 'host-away' });
    const t2 = await connect(`/room/${hosted.code}`);
    t2.send({ t: 'resume-host', code: hosted.code, token: hosted.token });
    expect(t2.all()[0]).toMatchObject({ t: 'hosted', resumed: true, code: hosted.code });
    expect(s.last()).toEqual({ t: 'host-back' });

    t2.send({ t: 'close' });
    expect(s.all().some((m) => m.t === 'ended')).toBe(true);
  });

  it('refuses a wrong code and unknown paths', async () => {
    const s = await connect('/room/ZZZZZZ');
    s.send({ t: 'join', code: 'ZZZZZZ' });
    expect(s.last()).toMatchObject({ t: 'error', code: 'BAD_CODE' });
    const res = await worker.fetch(new Request('https://x.workers.dev/somewhere', { headers: { Upgrade: 'websocket' } }), env);
    expect(res.status).toBe(404);
  });
});

// ── Deploying through the Cloudflare API (fake API) ──
function fakeApi({ subdomain = null, migrationApplied = false, tokenOk = true } = {}) {
  const calls = [];
  const state = { subdomain, migrationApplied, uploads: [] };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const route = url.replace('https://api.cloudflare.com/client/v4', '');
    calls.push(`${init.method} ${route}`);
    if (init.headers.Authorization !== 'Bearer TEST_TOKEN_0123456789abcdefghijklmnopqrstuv') return reply(401, { success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] });
    if (route === '/user/tokens/verify') return reply(200, { success: tokenOk, result: { status: 'active' } });
    if (route.startsWith('/accounts?')) return reply(200, { success: true, result: [{ id: 'acc1', name: "Asha's school" }] });
    if (route === '/accounts/acc1/workers/subdomain' && init.method === 'GET') {
      return state.subdomain ? reply(200, { success: true, result: { subdomain: state.subdomain } }) : reply(404, { success: false, errors: [{ code: 10007, message: 'This account does not have a workers.dev subdomain' }] });
    }
    if (route === '/accounts/acc1/workers/subdomain' && init.method === 'PUT') {
      state.subdomain = JSON.parse(init.body).subdomain;
      return reply(200, { success: true, result: { subdomain: state.subdomain } });
    }
    if (route === '/accounts/acc1/workers/scripts/theta172-relay' && init.method === 'PUT') {
      const meta = JSON.parse(await init.body.get('metadata').text());
      const code = await init.body.get('worker.js').text();
      state.uploads.push({ meta, code });
      if (meta.migrations && state.migrationApplied) return reply(400, { success: false, errors: [{ code: 10074, message: 'migration tag precondition failed; expected v1' }] });
      state.migrationApplied = true;
      return reply(200, { success: true, result: { id: 'theta172-relay' } });
    }
    if (route === '/accounts/acc1/workers/scripts/theta172-relay/subdomain') return reply(200, { success: true, result: { enabled: true } });
    return reply(404, { success: false, errors: [{ code: 7003, message: `no route ${route}` }] });
  };
  return { calls, state, fetchImpl };
}

describe('setting up the relay on a Cloudflare account', () => {
  const TOKEN = 'TEST_TOKEN_0123456789abcdefghijklmnopqrstuv';

  it('makes a workers.dev name if needed, uploads with the Durable Object and switches the address on', async () => {
    const api = fakeApi();
    const steps = [];
    const d = new CloudflareDeployer({ token: TOKEN, fetchImpl: api.fetchImpl, onStep: (s) => steps.push(`${s.id}:${s.state}`) });
    const r = await d.run({ subdomain: "Asha's School" });
    expect(r.url).toBe('wss://theta172-relay.ashasschool.workers.dev');
    expect(r.newSubdomain).toBe(true);
    const meta = api.state.uploads[0].meta;
    expect(meta.main_module).toBe('worker.js');
    expect(meta.bindings).toEqual([{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'ClassRoom' }]);
    expect(meta.migrations).toEqual({ new_tag: 'v1', new_sqlite_classes: ['ClassRoom'] });
    expect(api.state.uploads[0].code).toMatch(/export class ClassRoom/);
    expect(steps).toEqual(['token:run', 'token:ok', 'subdomain:run', 'subdomain:ok', 'upload:run', 'upload:ok', 'enable:run', 'enable:ok']);
  });

  it('updates an existing relay without the migration', async () => {
    const api = fakeApi({ subdomain: 'asha', migrationApplied: true });
    const r = await new CloudflareDeployer({ token: TOKEN, fetchImpl: api.fetchImpl }).run();
    expect(r.url).toBe('wss://theta172-relay.asha.workers.dev');
    expect(api.state.uploads.map((u) => !!u.meta.migrations)).toEqual([true, false]);
    expect(api.calls).not.toContain('PUT /accounts/acc1/workers/subdomain');
  });

  it('says plainly when the token is wrong', async () => {
    const api = fakeApi();
    const d = new CloudflareDeployer({ token: 'WRONG_TOKEN_0123456789abcdefghijklmnopqrst', fetchImpl: api.fetchImpl });
    await expect(d.run()).rejects.toThrow(/did not accept this token/);
    expect(() => new CloudflareDeployer({ token: 'short' })).toThrow(/does not look like/);
  });

  it('says plainly when there is no internet', async () => {
    const d = new CloudflareDeployer({ token: TOKEN, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await expect(d.run()).rejects.toThrow(/Could not reach Cloudflare/);
  });
});

describe('invites', () => {
  it('reads "CODE @ address" from the code box', () => {
    expect(parseInvite('K7M-4QX @ theta172-relay.asha.workers.dev')).toEqual({ code: 'K7M4QX', relayUrl: 'wss://theta172-relay.asha.workers.dev' });
    expect(parseInvite('k7m4qx@ws://10.0.0.5:8787')).toEqual({ code: 'K7M4QX', relayUrl: 'ws://10.0.0.5:8787' });
    expect(parseInvite('K7M-4QX')).toBe(null);
    expect(parseInvite('K7M-4QX @ ')).toBe(null);
  });

  it('writes the invite the teacher shares', () => {
    expect(inviteText('K7M4QX', 'wss://theta172-relay.asha.workers.dev/')).toBe('K7M-4QX @ theta172-relay.asha.workers.dev');
    expect(inviteText('K7M4QX', 'ws://10.0.0.5:8787')).toBe('K7M-4QX @ ws://10.0.0.5:8787');
    expect(inviteText('K7M4QX', '')).toBe('K7M-4QX');
    const back = parseInvite(inviteText('K7M4QX', 'wss://relay.school.in/class'));
    expect(back).toEqual({ code: 'K7M4QX', relayUrl: 'wss://relay.school.in/class' });
  });

  it('builds relay paths on any base address', () => {
    expect(relayPath('wss://a.workers.dev', '/host')).toBe('wss://a.workers.dev/host');
    expect(relayPath('wss://school.in/relay/', '/room/K7M4QX')).toBe('wss://school.in/relay/room/K7M4QX');
  });
});

describe('the Node relay (Docker, this computer)', () => {
  let srv;
  let url;
  afterEach(async () => { await srv?.close(); srv = null; });

  it('passes the same test class the app runs after setup', async () => {
    srv = createRelayServer();
    const port = await srv.listen(0, '127.0.0.1');
    url = `ws://127.0.0.1:${port}`;
    const r = await testRelay(url, { timeoutMs: 4000 });
    expect(r).toMatchObject({ ok: true });
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((x) => x.json());
    expect(health).toMatchObject({ ok: true, relay: 'theta172' });
  });

  it('reports a relay that is not there', async () => {
    const r = await testRelay('ws://127.0.0.1:9', { timeoutMs: 2000 });
    expect(r.ok).toBe(false);
  });

  it('exports a folder Docker can build', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-relay-'));
    exportRelayFolder(dir);
    for (const f of ['server.js', 'relay-node.cjs', 'relay-core.cjs', 'package.json', 'Dockerfile', '.dockerignore', 'README.txt']) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    // The exported server finds its rules next to it (ws comes from npm install in Docker; here from the repo)
    const out = execFileSync(process.execPath, ['-e', "const s = require('./server.js'); console.log(typeof s.listen, require.resolve('./relay-core.cjs') === require('path').resolve('relay-core.cjs')); s.close()"], {
      cwd: dir, env: { ...process.env, NODE_PATH: path.resolve('node_modules') }, encoding: 'utf8',
    });
    expect(out.trim()).toBe('function true');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

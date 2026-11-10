/**
 * THETA172 — set up the class relay on the teacher's own Cloudflare account.
 *
 * The teacher (or the school's IT person) makes a free Cloudflare account
 * and an API token from the "Edit Cloudflare Workers" template, pastes the
 * token into the app, and this module does the rest through Cloudflare's
 * API: checks the token, finds the account, makes sure it has a workers.dev
 * address, uploads the relay (one Durable Object per class), switches the
 * address on, and tests a real class through it.
 *
 * The token is used only for these calls. It is not written anywhere unless
 * the teacher asks the app to remember it (then it is encrypted by Windows
 * through Electron's safeStorage).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://api.cloudflare.com/client/v4';
const SCRIPT_NAME = 'theta172-relay';
const COMPAT_DATE = '2025-09-01';

const LINKS = {
  signUp: 'https://dash.cloudflare.com/sign-up',
  tokens: 'https://dash.cloudflare.com/profile/api-tokens',
  workers: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages',
  pricing: 'https://developers.cloudflare.com/durable-objects/platform/pricing/',
};

/** The relay as one Worker module: the shared rules, then the Cloudflare wrapper. */
function buildWorkerScript() {
  // The Node export at the end of the core is not needed (nor valid) in a Worker module
  const core = fs.readFileSync(path.join(__dirname, 'relay-core.cjs'), 'utf8').replace(/\/\* Node: module\.exports[\s\S]*$/, '');
  const wrapper = fs.readFileSync(path.join(__dirname, 'relay-worker.js'), 'utf8');
  return `${core}\n\n/* ── Cloudflare wrapper ── */\n${wrapper}`;
}

/** A readable message from a Cloudflare API reply. */
function cfError(body, status) {
  const first = body && Array.isArray(body.errors) && body.errors[0];
  if (first) return { code: first.code, message: String(first.message || 'Cloudflare refused the request.') };
  return { code: status, message: `Cloudflare answered ${status}.` };
}

class CloudflareDeployer {
  /**
   * @param {{ token: string, fetchImpl?: typeof fetch, onStep?: (step: {id: string, state: 'run'|'ok'|'fail'|'skip', note?: string}) => void }} opts
   */
  constructor({ token, fetchImpl = globalThis.fetch, onStep }) {
    if (typeof token !== 'string' || !/^[\x21-\x7e]{30,400}$/.test(token.trim())) {
      throw new Error('That does not look like a Cloudflare API token. Copy the whole token from the Cloudflare page.');
    }
    this.token = token.trim();
    this.fetch = fetchImpl;
    this.onStep = onStep || (() => {});
  }

  async call(method, route, body, { form } = {}) {
    const headers = { Authorization: `Bearer ${this.token}` };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    try {
      res = await this.fetch(`${API}${route}`, { method, headers, body: payload, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      const e = new Error('Could not reach Cloudflare. Check the internet connection and try again.');
      e.cause = err;
      e.offline = true;
      throw e;
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok || !json || json.success === false) {
      const { code, message } = cfError(json, res.status);
      const e = new Error(message);
      e.cfCode = code;
      e.status = res.status;
      throw e;
    }
    return json.result;
  }

  async step(id, fn) {
    this.onStep({ id, state: 'run' });
    try {
      const out = await fn();
      this.onStep({ id, state: 'ok', note: out && out.note });
      return out;
    } catch (err) {
      this.onStep({ id, state: 'fail', note: err.message });
      throw err;
    }
  }

  /** Check the token and find the account. */
  async verify() {
    return this.step('token', async () => {
      let t = null;
      try {
        t = await this.call('GET', '/user/tokens/verify');
      } catch (err) {
        if (err.offline) throw err;
        // An account-owned token cannot use the user endpoint; the account list below still tells
      }
      if (t && t.status && t.status !== 'active') throw new Error(`This token is ${t.status}. Make a new one.`);
      let accounts;
      try {
        accounts = await this.call('GET', '/accounts?per_page=50');
      } catch (err) {
        if (err.status === 401 || err.status === 403 || err.cfCode === 1000 || err.cfCode === 6003 || err.cfCode === 9109) {
          throw new Error('Cloudflare did not accept this token. Copy it again (the whole line), or make a new one.');
        }
        throw err;
      }
      if (!Array.isArray(accounts) || !accounts.length) {
        throw new Error('The token cannot see any account. Make it again from the "Edit Cloudflare Workers" template, with "All accounts" (or your account) chosen.');
      }
      this.account = { id: accounts[0].id, name: accounts[0].name };
      return { note: this.account.name, account: this.account, accounts: accounts.map((a) => ({ id: a.id, name: a.name })) };
    });
  }

  /** The account's workers.dev name; made if it has none yet. */
  async ensureSubdomain(wanted) {
    return this.step('subdomain', async () => {
      const id = this.account.id;
      try {
        const r = await this.call('GET', `/accounts/${id}/workers/subdomain`);
        if (r && r.subdomain) { this.subdomain = r.subdomain; return { note: `${r.subdomain}.workers.dev` }; }
      } catch (err) {
        if (err.status !== 404 && err.cfCode !== 10007) throw err;
      }
      const base = (wanted || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);
      const tries = [base, `${base || 'theta172'}-${Math.random().toString(36).slice(2, 6)}`, `theta172-${Math.random().toString(36).slice(2, 8)}`].filter(Boolean);
      let last;
      for (const name of tries) {
        try {
          const r = await this.call('PUT', `/accounts/${id}/workers/subdomain`, { subdomain: name });
          this.subdomain = (r && r.subdomain) || name;
          this.newSubdomain = true;
          return { note: `${this.subdomain}.workers.dev (new)` };
        } catch (err) { last = err; }
      }
      throw last || new Error('Could not choose a workers.dev name.');
    });
  }

  /** Upload the relay with its Durable Object. */
  async upload() {
    return this.step('upload', async () => {
      const id = this.account.id;
      const script = buildWorkerScript();
      const send = async (withMigration) => {
        const metadata = {
          main_module: 'worker.js',
          compatibility_date: COMPAT_DATE,
          bindings: [{ type: 'durable_object_namespace', name: 'ROOMS', class_name: 'ClassRoom' }],
        };
        if (withMigration) metadata.migrations = { new_tag: 'v1', new_sqlite_classes: ['ClassRoom'] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }), 'metadata.json');
        form.append('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');
        return this.call('PUT', `/accounts/${id}/workers/scripts/${SCRIPT_NAME}`, undefined, { form });
      };
      try {
        await send(true);
        return { note: 'uploaded' };
      } catch (err) {
        // Set up before: the Durable Object already exists, so upload without the migration
        if (/migration|tag/i.test(err.message)) { await send(false); return { note: 'updated' }; }
        throw err;
      }
    });
  }

  /** Turn on https://theta172-relay.<name>.workers.dev */
  async enable() {
    return this.step('enable', async () => {
      await this.call('POST', `/accounts/${this.account.id}/workers/scripts/${SCRIPT_NAME}/subdomain`, { enabled: true, previews_enabled: false });
      this.url = `wss://${SCRIPT_NAME}.${this.subdomain}.workers.dev`;
      return { note: this.url.replace('wss://', '') };
    });
  }

  /** Everything, in order. Resolves with { url, account }. */
  async run({ subdomain } = {}) {
    await this.verify();
    await this.ensureSubdomain(subdomain || this.account.name);
    await this.upload();
    await this.enable();
    return { url: this.url, account: this.account, newSubdomain: !!this.newSubdomain };
  }
}

/**
 * Is a relay at this address alive, and does a class work through it?
 * Opens a class as a teacher, joins it as a student and sends a message both ways.
 * @returns {Promise<{ ok: boolean, ms?: number, step?: string, message?: string }>}
 */
async function testRelay(url, { WebSocketImpl = require('ws'), timeoutMs = 12_000 } = {}) {
  const { relayPath, validRelayUrl } = require('./classroom-relay.cjs');
  if (!validRelayUrl(url)) return { ok: false, step: 'address', message: 'That is not a relay address (it starts with wss://).' };
  const started = Date.now();
  const open = (addr) => new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(addr, { handshakeTimeout: timeoutMs });
    const timer = setTimeout(() => { try { ws.terminate(); } catch (_) { /* gone */ } reject(new Error('timeout')); }, timeoutMs);
    const queue = [];
    let waiter = null;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch (_) { return; }
      if (m.t === 'ping') return;
      if (waiter) { const w = waiter; waiter = null; w(m); } else queue.push(m);
    });
    ws.on('open', () => { clearTimeout(timer); resolve({
      ws,
      send: (o) => ws.send(JSON.stringify(o)),
      next: () => new Promise((res, rej) => {
        if (queue.length) return res(queue.shift());
        const t = setTimeout(() => { waiter = null; rej(new Error('timeout')); }, timeoutMs);
        waiter = (m) => { clearTimeout(t); res(m); };
        return undefined;
      }),
    }); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  let host;
  let student;
  let step = 'connect';
  try {
    host = await open(relayPath(url, '/host'));
    step = 'host';
    host.send({ t: 'host', name: 'Relay test' });
    const hosted = await host.next();
    if (hosted.t !== 'hosted') throw new Error(hosted.message || 'The relay did not open a class.');
    step = 'join';
    student = await open(relayPath(url, `/room/${hosted.code}`));
    student.send({ t: 'join', code: hosted.code });
    const joined = await student.next();
    if (joined.t !== 'joined') throw new Error(joined.message || 'Could not join the test class.');
    const peer = await host.next();
    step = 'message';
    student.send({ t: 'send', data: 'hello teacher' });
    const got = await host.next();
    if (got.t !== 'msg' || got.data !== 'hello teacher') throw new Error('A message did not arrive.');
    host.send({ t: 'send', to: peer.id, data: 'hello student' });
    const back = await student.next();
    if (back.t !== 'msg' || back.data !== 'hello student') throw new Error('A message did not arrive.');
    host.send({ t: 'close' });
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    const msg = err.message === 'timeout' ? 'The relay did not answer in time.' : String(err.message || err);
    return { ok: false, step, message: msg };
  } finally {
    try { host?.ws.close(); } catch (_) { /* gone */ }
    try { student?.ws.close(); } catch (_) { /* gone */ }
  }
}

/** Test again and again while a new workers.dev address comes up (it can take a minute or two). */
async function waitForRelay(url, { totalMs = 120_000, onTry, testImpl = testRelay } = {}) {
  const until = Date.now() + totalMs;
  let attempt = 0;
  let last;
  while (Date.now() < until) {
    attempt++;
    last = await testImpl(url, { timeoutMs: 10_000 });
    onTry?.(attempt, last);
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, Math.min(3000 + attempt * 1000, 10_000)));
  }
  return last || { ok: false, message: 'The relay did not come up.' };
}

module.exports = { CloudflareDeployer, buildWorkerScript, testRelay, waitForRelay, LINKS, SCRIPT_NAME };

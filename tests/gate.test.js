/**
 * The owner's remote gate (license / kill switch): signature verification,
 * tamper rejection, the lock decision, anti-rollback, and that an offline
 * copy stays locked once the owner has turned it off.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { verify, decide, createGate } = require('../electron/gate.cjs');

// A throwaway owner key for the tests (the real public key ships in the app)
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (payload) => {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.sign(null, Buffer.from(b64, 'utf8'), privateKey).toString('base64');
  return JSON.stringify({ payload: b64, sig });
};

describe('verifying the owner document', () => {
  it('accepts a document signed by the owner', () => {
    const v = verify(sign({ status: 'enabled', issuedAt: 1 }), PUB);
    expect(v?.payload).toMatchObject({ status: 'enabled' });
  });

  it('rejects a tampered payload, a bad signature and junk', () => {
    const good = JSON.parse(sign({ status: 'disabled', issuedAt: 5 }));
    // flip the payload to "enabled" but keep the old signature
    const forged = JSON.stringify({ payload: Buffer.from(JSON.stringify({ status: 'enabled', issuedAt: 5 })).toString('base64'), sig: good.sig });
    expect(verify(forged, PUB)).toBe(null);
    expect(verify(JSON.stringify({ payload: good.payload, sig: 'AAAA' }), PUB)).toBe(null);
    expect(verify('not json', PUB)).toBe(null);
    expect(verify(sign({ status: 'enabled', issuedAt: 1 }))).toBe(null); // wrong (real) key
  });

  it('rejects a document with an unknown status', () => {
    expect(verify(sign({ status: 'whatever', issuedAt: 1 }), PUB)).toBe(null);
  });

  it('the committed license.json is validly signed and enabled', () => {
    const v = verify(fs.readFileSync(new URL('../license.json', import.meta.url), 'utf8'));
    expect(v?.payload.status).toBe('enabled');
    expect(v?.payload.enforcement).toBe('lenient'); // ships running-as-now
  });
});

describe('the lock decision', () => {
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  it('no document → runs (lenient default)', () => expect(decide(null, id).locked).toBe(false));
  it('enabled → runs', () => expect(decide({ status: 'enabled', enforcement: 'lenient', issuedAt: 1 }, id).locked).toBe(false));
  it('disabled → locks, with the owner message', () => {
    const d = decide({ status: 'disabled', issuedAt: 1, message: 'Paused by THETA172' }, id);
    expect(d).toMatchObject({ locked: true, message: 'Paused by THETA172' });
  });
  it('strict + stale → locks', () => {
    const old = Date.now() - 1000 * 3600 * 1000;
    expect(decide({ status: 'enabled', enforcement: 'strict', maxAgeHours: 72, issuedAt: old }, id).locked).toBe(true);
    expect(decide({ status: 'enabled', enforcement: 'strict', maxAgeHours: 72, issuedAt: Date.now() }, id).locked).toBe(false);
  });
  it('blocks one device, and an allow-list locks everyone else', () => {
    expect(decide({ status: 'enabled', issuedAt: 1, blockedInstalls: [id] }, id).locked).toBe(true);
    expect(decide({ status: 'enabled', issuedAt: 1, blockedInstalls: ['other'] }, id).locked).toBe(false);
    expect(decide({ status: 'enabled', issuedAt: 1, allowedInstalls: ['someone-else'] }, id).locked).toBe(true);
    expect(decide({ status: 'enabled', issuedAt: 1, allowedInstalls: [id] }, id).locked).toBe(false);
  });
});

describe('the gate in the app', () => {
  let userData;
  const app = { isPackaged: true };
  beforeEach(() => { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-gate-')); });
  const fetchDoc = (text, ok = true) => async () => ({ ok, text: async () => text });

  it('a fresh install with no network runs (lenient)', async () => {
    const gate = createGate({ app, userData, fetchImpl: async () => { throw new Error('offline'); }, urls: ['x'], publicKey: PUB });
    expect((await gate.check()).locked).toBe(false);
  });

  it('a disabled document locks, and stays locked after going offline', async () => {
    const disabled = sign({ status: 'disabled', enforcement: 'lenient', issuedAt: 100, message: 'off' });
    const online = createGate({ app, userData, fetchImpl: fetchDoc(disabled), urls: ['x'], publicKey: PUB });
    expect((await online.check()).locked).toBe(true);
    // a new run of the app, now offline, reads the cache and stays locked
    const offline = createGate({ app, userData, fetchImpl: async () => { throw new Error('offline'); }, urls: ['x'], publicKey: PUB });
    expect(offline.cachedDecision().locked).toBe(true);
  });

  it('an older document can never roll a newer one back', async () => {
    const newer = sign({ status: 'disabled', issuedAt: 200 });
    const older = sign({ status: 'enabled', issuedAt: 100 });
    const g1 = createGate({ app, userData, fetchImpl: fetchDoc(newer), urls: ['x'], publicKey: PUB });
    expect((await g1.check()).locked).toBe(true);
    // the server now serves an older "enabled" — it must be ignored
    const g2 = createGate({ app, userData, fetchImpl: fetchDoc(older), urls: ['x'], publicKey: PUB });
    expect((await g2.check()).locked).toBe(true);
  });

  it('gives every install a stable id', () => {
    const a = createGate({ app, userData, publicKey: PUB });
    const b = createGate({ app, userData, publicKey: PUB });
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.id).toBe(b.id);
  });

  it('is inactive (always runs) when not packaged', async () => {
    const gate = createGate({ app: { isPackaged: false }, userData, fetchImpl: fetchDoc(sign({ status: 'disabled', issuedAt: 1 })), urls: ['x'], publicKey: PUB });
    expect(gate.active).toBe(false);
    expect((await gate.check()).locked).toBe(false);
  });
});

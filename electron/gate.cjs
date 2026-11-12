/**
 * THETA172 — the owner's remote gate (a license / kill switch).
 *
 * Every installed copy checks a small signed document the owner publishes.
 * Only the owner, holding the private key, can issue a valid document; the
 * app carries only the public key, so no one can forge or tamper with it.
 *
 * The document decides whether the app may open:
 *   status      "enabled"  → the app runs
 *               "disabled" → the app shows the lock screen and nothing else
 *   enforcement "lenient"  → if the document cannot be reached and none is
 *                            cached, the app runs (the default; current
 *                            behaviour is unchanged)
 *               "strict"   → the app runs only with a fresh "enabled"
 *                            document; otherwise it locks (fail-closed)
 *
 * A "disabled" document, once seen, is cached and keeps the app locked even
 * offline, and an older document can never roll a newer one back (the
 * highest issuedAt seen is remembered).
 *
 * The owner publishes the document with scripts/license.cjs. End users are
 * never told this exists; the lock screen only appears if the owner locks.
 *
 * Only runs in the packaged app. Dev and the test runner always allow.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The owner's public key. The matching private key never leaves the owner.
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAplaGiFzMvaeNSK7ktActzf0FI0tz+ebsznBoX+o//Ns=
-----END PUBLIC KEY-----`;

// Where the signed document is published. The owner can change license.json
// on the repo and every copy picks it up. jsdelivr is a cached mirror.
const GATE_URLS = [
  'https://raw.githubusercontent.com/shriomverma100/theta172-python-ide/main/license.json',
  'https://cdn.jsdelivr.net/gh/shriomverma100/theta172-python-ide@main/license.json',
];

const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // re-check every 2 hours while open
const FETCH_TIMEOUT_MS = 6000;

/** A random, stable id for this installation (so the owner can target one machine later). */
function installId(userData) {
  const file = path.join(userData, 'install-id');
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{32}$/.test(v)) return v;
  } catch (_) { /* first run */ }
  const id = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(file, id); } catch (_) { /* best effort */ }
  return id;
}

/** Verify a published document against the owner's public key. Returns the payload, or null. */
function verify(raw, publicKey = PUBLIC_KEY) {
  let doc;
  try { doc = JSON.parse(raw); } catch (_) { return null; }
  if (!doc || typeof doc.payload !== 'string' || typeof doc.sig !== 'string') return null;
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(doc.payload, 'utf8'), publicKey, Buffer.from(doc.sig, 'base64'));
  } catch (_) {
    return null;
  }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(doc.payload, 'base64').toString('utf8')); } catch (_) { return null; }
  if (!payload || !['enabled', 'disabled'].includes(payload.status) || typeof payload.issuedAt !== 'number') return null;
  return { payload, raw };
}

/** Decide from a verified payload (and this install's id) whether to lock. */
function decide(payload, id) {
  if (!payload) return { locked: false, reason: 'no-document' }; // lenient default: run
  // Targeting: a block list locks only named installs; an allow list locks everyone else
  const blocked = Array.isArray(payload.blockedInstalls) && payload.blockedInstalls.includes(id);
  const notAllowed = Array.isArray(payload.allowedInstalls) && !payload.allowedInstalls.includes(id);
  if (payload.status === 'disabled' || blocked || notAllowed) {
    return { locked: true, reason: 'disabled', message: payload.message || '', contact: payload.contact || '', until: payload.until || null };
  }
  if (payload.enforcement === 'strict') {
    const maxAge = (payload.maxAgeHours || 72) * 3600 * 1000;
    if (Date.now() - payload.issuedAt > maxAge) return { locked: true, reason: 'stale', message: payload.message || '', contact: payload.contact || '' };
  }
  return { locked: false, reason: 'enabled' };
}

/**
 * The gate for the main process.
 * @param {{ app: Electron.App, userData: string, fetchImpl?: typeof fetch, urls?: string[] }} deps
 */
function createGate({ app, userData, fetchImpl = globalThis.fetch, urls = GATE_URLS, publicKey = PUBLIC_KEY }) {
  const id = installId(userData);
  const cacheFile = path.join(userData, 'gate.json');
  const testUrl = process.env.THETA_GATE_URL;
  const active = app.isPackaged || !!testUrl; // dev and tests always allow

  const readCache = () => {
    try { return verify(fs.readFileSync(cacheFile, 'utf8'), publicKey); } catch (_) { return null; }
  };
  const writeCache = (v) => { try { fs.writeFileSync(cacheFile, v.raw); } catch (_) { /* best effort */ } };

  /** Fetch the newest valid document; keep it only if it is newer than what we have. */
  const refresh = async () => {
    const cached = readCache();
    const list = testUrl ? [testUrl] : urls;
    for (const url of list) {
      try {
        const res = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) continue;
        const v = verify(await res.text(), publicKey);
        if (!v) continue;
        // Anti-rollback: never accept a document older than the newest we have seen
        if (cached && v.payload.issuedAt < cached.payload.issuedAt) return cached;
        writeCache(v);
        return v;
      } catch (_) { /* try the next mirror */ }
    }
    return cached;
  };

  return {
    id,
    active,
    /** The decision to use at startup, from the cache only (instant, no network). */
    cachedDecision() {
      if (!active) return { locked: false, reason: 'inactive' };
      return decide(readCache()?.payload, id);
    },
    /** Refresh from the network, then return the fresh decision. */
    async check() {
      if (!active) return { locked: false, reason: 'inactive' };
      const v = await refresh();
      return decide(v?.payload, id);
    },
    CHECK_INTERVAL_MS,
  };
}

module.exports = { createGate, verify, decide, PUBLIC_KEY, GATE_URLS };

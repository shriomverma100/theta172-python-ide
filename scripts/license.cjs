/**
 * THETA172 — turn the software on or off, everywhere it runs.
 *
 * Only the owner can run this: it signs a small document with the private
 * key (kept in ~/.theta172/license-private.pem, never in the repo) and
 * writes license.json. Push license.json and every installed copy obeys it
 * within a few minutes, or the next time it opens.
 *
 *   npm run license -- status
 *   npm run license -- enable                      turn the software back on
 *   npm run license -- disable --message "..."     turn it off (shows the lock screen)
 *   npm run license -- strict                       require a fresh "on" (fail-closed)
 *   npm run license -- lenient                      run when the document can't be reached (default)
 *   npm run license -- block <deviceId>             turn off one computer
 *   npm run license -- unblock <deviceId>
 *
 *   add --push  to commit and push license.json for you
 *   add --dry   to see the result without writing
 *
 * The device id is the 8-character code shown on a locked computer's screen.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const licenseFile = path.join(root, 'license.json');
const keyFile = process.env.THETA_LICENSE_KEY || path.join(os.homedir(), '.theta172', 'license-private.pem');

const args = process.argv.slice(2);
const cmd = (args.find((a) => !a.startsWith('--')) || 'status').toLowerCase();
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined; };
const positional = args.filter((a) => !a.startsWith('--'));
const fail = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };

function loadKey() {
  if (!fs.existsSync(keyFile)) fail(`The private key is not at ${keyFile}.\n  Keep the key you were given safe; without it the software cannot be turned on or off.`);
  return crypto.createPrivateKey(fs.readFileSync(keyFile, 'utf8'));
}

/** The current published payload (so flags persist unless changed). */
function current() {
  try {
    const doc = JSON.parse(fs.readFileSync(licenseFile, 'utf8'));
    return JSON.parse(Buffer.from(doc.payload, 'base64').toString('utf8'));
  } catch (_) {
    return { status: 'enabled', enforcement: 'lenient', blockedInstalls: [], issuedAt: 0 };
  }
}

function sign(payload, key) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.sign(null, Buffer.from(b64, 'utf8'), key).toString('base64');
  return { payload: b64, sig };
}

const p = current();
p.blockedInstalls = Array.isArray(p.blockedInstalls) ? p.blockedInstalls : [];
let changed = true;

switch (cmd) {
  case 'status': {
    console.log(`\nSoftware is: ${p.status.toUpperCase()}`);
    console.log(`Enforcement: ${p.enforcement || 'lenient'}`);
    if (p.message) console.log(`Message:     ${p.message}`);
    if (p.blockedInstalls.length) console.log(`Blocked:     ${p.blockedInstalls.join(', ')}`);
    console.log(`Issued:      ${p.issuedAt ? new Date(p.issuedAt).toLocaleString() : 'never'}\n`);
    changed = false;
    break;
  }
  case 'enable': p.status = 'enabled'; delete p.message; delete p.contact; break;
  case 'disable':
    p.status = 'disabled';
    if (typeof flag('message') === 'string') p.message = flag('message');
    if (typeof flag('contact') === 'string') p.contact = flag('contact');
    break;
  case 'strict': p.enforcement = 'strict'; if (flag('hours')) p.maxAgeHours = Number(flag('hours')); break;
  case 'lenient': p.enforcement = 'lenient'; break;
  case 'block': {
    const id = positional[1];
    if (!id) fail('Give the device id to block: npm run license -- block <deviceId>');
    if (!p.blockedInstalls.includes(id)) p.blockedInstalls.push(id);
    break;
  }
  case 'unblock': {
    const id = positional[1];
    if (!id) fail('Give the device id to unblock.');
    p.blockedInstalls = p.blockedInstalls.filter((x) => x !== id && !x.startsWith(id));
    break;
  }
  default: fail(`Unknown command "${cmd}". Use status, enable, disable, strict, lenient, block or unblock.`);
}

if (!changed) process.exit(0);

p.enforcement = p.enforcement || 'lenient';
p.issuedAt = Math.max(Date.now(), (p.issuedAt || 0) + 1); // always newer than the last (anti-rollback)
const doc = sign(p, loadKey());
const json = `${JSON.stringify(doc)}\n`;

console.log(`\n${cmd === 'disable' || p.status === 'disabled' ? '⛔ Software will be OFF' : '✓ Software will be ON'}  ·  ${p.enforcement}${p.blockedInstalls.length ? `  ·  ${p.blockedInstalls.length} device(s) blocked` : ''}`);
if (p.message) console.log(`   "${p.message}"`);

if (flag('dry')) { console.log('\nDry run: license.json not written.\n'); process.exit(0); }

fs.writeFileSync(licenseFile, json);
console.log(`\nWrote ${licenseFile}`);

if (flag('push')) {
  const git = (...a) => execFileSync('git', ['-c', 'safe.directory=*', ...a], { cwd: root, stdio: 'inherit' });
  try {
    git('add', 'license.json');
    git('commit', '-m', `license: ${p.status}${p.message ? ` — ${p.message}` : ''}`);
    git('push', 'origin', 'main');
    console.log('\nPushed. Installed copies will obey within a few minutes (or the next time they open).\n');
  } catch (_) { fail('Could not push. Commit and push license.json yourself.'); }
} else {
  console.log('\nNow commit and push license.json (or re-run with --push):');
  console.log('  git add license.json && git commit -m "license update" && git push\n');
}

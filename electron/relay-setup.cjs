/**
 * THETA172 — "Set up your own relay": the checks and the work behind the
 * three ways a school can run the class relay.
 *
 *   1. Cloudflare (free account, recommended): cloudflare-deploy.cjs uploads it.
 *   2. Docker on a school server: export the relay folder, build and run it.
 *   3. This computer: the relay runs inside the app while it is open.
 *
 * Everything the window may ask for is a fixed IPC handler; links open only
 * from the fixed list below.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { CloudflareDeployer, testRelay, waitForRelay, LINKS: CF_LINKS } = require('./cloudflare-deploy.cjs');
const { validRelayUrl } = require('./classroom-relay.cjs');

const LINKS = {
  ...CF_LINKS,
  docker: 'https://www.docker.com/products/docker-desktop/',
  dockerWindows: 'https://docs.docker.com/desktop/setup/install/windows-install/',
  wsl: 'https://learn.microsoft.com/windows/wsl/install',
};

const DOCKER_NAME = 'theta172-relay';
const RELAY_PORT = 8787;

/** Run a program; never throws. */
function run(cmd, args, { timeout = 15_000, onLine } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, missing: !!err && err.code === 'ENOENT', stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    if (onLine) {
      const feed = (buf) => String(buf).split(/\r?\n/).forEach((l) => { if (l.trim()) onLine(l); });
      child.stdout?.on('data', feed);
      child.stderr?.on('data', feed);
    }
  });
}

/** The computer's addresses other computers can reach (IPv4, not internal). */
function localAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
    }
  }
  // Wi-Fi and Ethernet first, virtual adapters (Docker, VirtualBox, WSL) last
  const virtual = /vEthernet|VirtualBox|VMware|WSL|Docker|Hyper-V|Loopback/i;
  return out.sort((a, b) => Number(virtual.test(a.name)) - Number(virtual.test(b.name)));
}

async function checkInternet(fetchImpl = globalThis.fetch) {
  const started = Date.now();
  try {
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/ips', { signal: AbortSignal.timeout(8000) });
    return { ok: res.ok || res.status < 500, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, message: 'No internet connection (or Cloudflare is blocked on this network).' };
  }
}

async function checkDocker() {
  const v = await run('docker', ['--version'], { timeout: 8000 });
  if (!v.ok) return { installed: false, running: false };
  const version = (v.stdout.match(/Docker version ([^\s,]+)/) || [])[1] || v.stdout.trim();
  const info = await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 });
  const running = info.ok && !!info.stdout.trim();
  let container = null;
  if (running) {
    const ps = await run('docker', ['ps', '-a', '--filter', `name=^${DOCKER_NAME}$`, '--format', '{{.Status}}'], { timeout: 8000 });
    const status = ps.stdout.trim();
    if (status) container = { status, up: /^Up/i.test(status) };
  }
  return { installed: true, running, version, container };
}

/** Write the relay as a folder Docker (or plain Node) can run. */
function exportRelayFolder(dest) {
  const repo = path.join(__dirname, '..', 'relay-server');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['server.js', 'package.json', 'Dockerfile', '.dockerignore']) {
    fs.writeFileSync(path.join(dest, f), fs.readFileSync(path.join(repo, f)));
  }
  for (const f of ['relay-node.cjs', 'relay-core.cjs']) {
    fs.writeFileSync(path.join(dest, f), fs.readFileSync(path.join(__dirname, f)));
  }
  fs.writeFileSync(path.join(dest, 'README.txt'), [
    'THETA172 classroom relay',
    '',
    'Run with Docker:',
    `  docker build -t ${DOCKER_NAME} .`,
    `  docker run -d --name ${DOCKER_NAME} --restart unless-stopped -p ${RELAY_PORT}:${RELAY_PORT} ${DOCKER_NAME}`,
    '',
    'Or with Node.js 18+:',
    '  npm install',
    '  npm start',
    '',
    `The relay answers on port ${RELAY_PORT}. Students on other networks can reach it only if this`,
    'computer has a public address or sits behind an HTTPS proxy (then use wss://your.address).',
    '',
  ].join('\r\n'));
  return dest;
}

/**
 * Wire the relay setup into the app.
 * @param {{ ipcMain: Electron.IpcMain, shell: Electron.Shell, safeStorage?: Electron.SafeStorage, userData: string, toWindow: Function }} deps
 */
function registerRelaySetupIpc({ ipcMain, shell, safeStorage, userData, toWindow }) {
  const tokenFile = path.join(userData, 'relay-cf-token.bin');
  const dockerDir = path.join(userData, 'relay-docker');
  let campus = null; // { server, port, startedAt }
  let busy = false;

  const savedToken = () => {
    try {
      if (!safeStorage?.isEncryptionAvailable() || !fs.existsSync(tokenFile)) return null;
      return safeStorage.decryptString(fs.readFileSync(tokenFile));
    } catch (_) {
      return null;
    }
  };

  const campusUrls = () => (campus ? localAddresses().map((a) => ({ name: a.name, url: `ws://${a.address}:${campus.port}` })) : []);

  const guard = async (fn) => {
    if (busy) return { ok: false, message: 'Setup is already running.' };
    busy = true;
    try { return await fn(); } finally { busy = false; }
  };

  ipcMain.handle('relay-setup-check', async () => {
    const [internet, docker] = await Promise.all([checkInternet(), checkDocker()]);
    return {
      internet,
      docker,
      campus: campus ? { running: true, port: campus.port, urls: campusUrls() } : { running: false },
      cloudflare: { tokenSaved: !!savedToken(), canSave: !!safeStorage?.isEncryptionAvailable() },
      platform: process.platform,
    };
  });

  ipcMain.handle('relay-open-link', (_e, key) => {
    if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(LINKS, key)) shell.openExternal(LINKS[key]);
  });

  // ── Cloudflare ──
  ipcMain.handle('relay-cf-deploy', (_e, opts = {}) => guard(async () => {
    const token = typeof opts.token === 'string' && opts.token.trim() ? opts.token.trim() : savedToken();
    if (!token) return { ok: false, step: 'token', message: 'Paste your Cloudflare API token first.' };
    let deployer;
    try {
      deployer = new CloudflareDeployer({ token, onStep: (s) => toWindow('relay-setup-step', s) });
    } catch (err) {
      toWindow('relay-setup-step', { id: 'token', state: 'fail', note: err.message });
      return { ok: false, step: 'token', message: err.message };
    }
    let result;
    try {
      result = await deployer.run({ subdomain: typeof opts.subdomain === 'string' ? opts.subdomain : '' });
    } catch (err) {
      return { ok: false, message: err.message };
    }
    if (opts.remember && safeStorage?.isEncryptionAvailable()) {
      try { fs.writeFileSync(tokenFile, safeStorage.encryptString(token)); } catch (_) { /* not critical */ }
    }
    toWindow('relay-setup-step', { id: 'test', state: 'run', note: result.newSubdomain ? 'A new address can take a minute or two' : '' });
    const test = await waitForRelay(result.url, {
      totalMs: result.newSubdomain ? 240_000 : 120_000,
      onTry: (n, r) => { if (!r.ok) toWindow('relay-setup-step', { id: 'test', state: 'run', note: `Waiting for Cloudflare to switch the address on (try ${n})…` }); },
    });
    toWindow('relay-setup-step', { id: 'test', state: test.ok ? 'ok' : 'fail', note: test.ok ? `A test class worked (${test.ms} ms)` : test.message });
    return { ok: test.ok, url: result.url, account: result.account.name, test };
  }));

  ipcMain.handle('relay-cf-forget', () => {
    try { fs.rmSync(tokenFile, { force: true }); } catch (_) { /* gone */ }
    return true;
  });

  ipcMain.handle('relay-test', async (_e, url) => {
    if (!validRelayUrl(url)) return { ok: false, message: 'That is not a relay address (it starts with wss://).' };
    return testRelay(url);
  });

  // ── Docker ──
  ipcMain.handle('relay-docker-start', () => guard(async () => {
    const log = (line) => toWindow('relay-setup-log', String(line).slice(0, 400));
    const d = await checkDocker();
    if (!d.installed) return { ok: false, message: 'Docker is not installed on this computer.' };
    if (!d.running) return { ok: false, message: 'Docker is installed but not running. Open Docker Desktop, wait until it says "Engine running", then try again.' };
    exportRelayFolder(dockerDir);
    log(`Relay files written to ${dockerDir}`);
    log('Building the relay image (the first time downloads Node.js, about 50 MB)…');
    const build = await run('docker', ['build', '-t', DOCKER_NAME, dockerDir], { timeout: 600_000, onLine: log });
    if (!build.ok) return { ok: false, message: 'Docker could not build the relay. See the log above.' };
    await run('docker', ['rm', '-f', DOCKER_NAME], { timeout: 30_000 });
    log('Starting the relay…');
    const up = await run('docker', ['run', '-d', '--name', DOCKER_NAME, '--restart', 'unless-stopped', '-p', `${RELAY_PORT}:${RELAY_PORT}`, DOCKER_NAME], { timeout: 60_000, onLine: log });
    if (!up.ok) {
      const busyPort = /port is already allocated|address already in use/i.test(up.stderr);
      return { ok: false, message: busyPort ? `Port ${RELAY_PORT} is in use (is "This computer" relay on?). Stop it and try again.` : 'Docker could not start the relay. See the log above.' };
    }
    const local = `ws://127.0.0.1:${RELAY_PORT}`;
    const test = await waitForRelay(local, { totalMs: 30_000 });
    const urls = localAddresses().map((a) => ({ name: a.name, url: `ws://${a.address}:${RELAY_PORT}` }));
    return { ok: test.ok, urls, test, message: test.ok ? '' : test.message };
  }));

  ipcMain.handle('relay-docker-stop', async () => {
    const r = await run('docker', ['rm', '-f', DOCKER_NAME], { timeout: 30_000 });
    return { ok: r.ok };
  });

  ipcMain.handle('relay-docker-folder', () => {
    exportRelayFolder(dockerDir);
    shell.openPath(dockerDir);
    return dockerDir;
  });

  // ── This computer ──
  ipcMain.handle('relay-campus-start', async () => {
    if (campus) return { ok: true, port: campus.port, urls: campusUrls() };
    const { createRelayServer } = require('./relay-node.cjs');
    const server = createRelayServer({ trustProxy: false });
    try {
      const port = await server.listen(RELAY_PORT, '0.0.0.0');
      campus = { server, port, startedAt: Date.now() };
    } catch (err) {
      await server.close();
      return { ok: false, message: err.code === 'EADDRINUSE' ? `Port ${RELAY_PORT} is in use (is the Docker relay running?).` : err.message };
    }
    return { ok: true, port: campus.port, urls: campusUrls() };
  });

  ipcMain.handle('relay-campus-stop', async () => {
    if (campus) { await campus.server.close(); campus = null; }
    return { ok: true };
  });

  return {
    dispose: () => { if (campus) { campus.server.close(); campus = null; } },
  };
}

module.exports = { registerRelaySetupIpc, exportRelayFolder, checkDocker, checkInternet, localAddresses, LINKS };

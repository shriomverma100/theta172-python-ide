/**
 * THETA172 — Python interpreter & package IPC (main process).
 *
 * Owns the "active interpreter": the Python that Run, the REPL, package
 * installs and the Shell all use. The renderer can only pick from the list
 * this process discovered, and package names are validated here.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { PythonEnvironments } = require('./python-env.cjs');
const { isValidPackageSpec } = require('./validate.cjs');

const OS = { win32: 'win', darwin: 'mac', linux: 'linux' };
const PACKAGE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Where the bundled Python and uv live: app resources when packaged, vendor/ in development. */
function bundledPaths(app, platform = process.platform, arch = process.arch) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'vendor', `${OS[platform] || platform}-${arch}`);
  const win = platform === 'win32';
  const python = win ? path.join(base, 'python', 'python.exe') : path.join(base, 'python', 'bin', 'python3');
  const uv = path.join(base, 'uv', win ? 'uv.exe' : 'uv');
  const ruff = path.join(base, 'ruff', win ? 'ruff.exe' : 'ruff');
  const have = (p) => (fs.existsSync(p) ? p : null);
  return { python: have(python), uv: have(uv), ruff: have(ruff) };
}

function registerPythonIpc({ ipcMain, app, execFile, spawn, getWindow, getRoot, onActiveChange }) {
  const envs = new PythonEnvironments({
    execFile, spawn, fs,
    userData: app.getPath('userData'),
    bundled: bundledPaths(app),
  });
  let list = [];
  let active = null;
  let busy = null; // one environment change at a time

  const send = (ch, ...args) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(ch, ...args);
  };
  const log = (text) => send('py-log', text);

  const setActive = (info) => {
    const changed = info?.path !== active?.path;
    active = info || null;
    onActiveChange?.(active);
    if (changed) send('py-changed', publicState());
  };

  const publicState = () => ({
    active,
    list,
    hasBundled: !!envs.bundled.python,
    hasUv: envs.hasUv,
    root: getRoot() || null,
    hasRequirements: !!getRoot() && fs.existsSync(path.join(getRoot(), 'requirements.txt')),
  });

  const refresh = async (rescan = true) => {
    list = await envs.discover(getRoot(), { rescan });
    setActive(envs.resolveActive(getRoot(), list));
    return publicState();
  };

  const exclusive = async (label, fn) => {
    if (busy) throw new Error(`Please wait: ${busy}.`);
    busy = label;
    try { return await fn(); } finally { busy = null; }
  };

  const needActive = () => {
    if (!active) throw new Error('No Python selected. Open the Python picker to choose one.');
    return active.path;
  };

  // First start: make the default environment from the built-in Python
  ipcMain.handle('py-init', async () => {
    if (envs.needsDefaultEnv()) {
      send('py-status', envs.defaultEnvIsStale() ? 'Updating Python for the new app folder…' : 'Preparing Python (first run)…');
      await exclusive('preparing Python', () => envs.ensureDefaultEnv(log));
    }
    return refresh();
  });

  ipcMain.handle('py-list', (_e, rescan) => refresh(rescan !== false));
  ipcMain.handle('py-active', () => publicState());

  ipcMain.handle('py-select', (_e, exe) => {
    const info = envs.select(exe, getRoot());
    setActive(info);
    return publicState();
  });

  ipcMain.handle('py-create-env', () => exclusive('creating the environment', async () => {
    const root = getRoot();
    if (!root) throw new Error('Open a project folder first.');
    log(`Creating .venv in ${path.basename(root)}…\n`);
    const exe = await envs.createProjectEnv(root, null, log);
    await refresh();
    setActive(envs.select(exe, root));
    log('Environment ready.\n');
    return publicState();
  }));

  ipcMain.handle('py-install', (_e, specs) => exclusive('installing packages', async () => {
    const python = needActive();
    const list_ = (Array.isArray(specs) ? specs : [specs]).slice(0, 50);
    if (!list_.length || !list_.every(isValidPackageSpec)) throw new Error('Invalid package name.');
    log(`Installing ${list_.join(', ')}…\n`);
    const code = await envs.install(python, list_, log, { cwd: getRoot() || undefined });
    return { ok: code === 0, code };
  }));

  ipcMain.handle('py-install-requirements', () => exclusive('installing requirements', async () => {
    const python = needActive();
    const root = getRoot();
    const file = root && path.join(root, 'requirements.txt');
    if (!file || !fs.existsSync(file)) throw new Error('This project has no requirements.txt.');
    log('Installing from requirements.txt…\n');
    const code = await envs.installRequirements(python, file, log);
    return { ok: code === 0, code };
  }));

  ipcMain.handle('py-uninstall', (_e, name) => exclusive('removing a package', async () => {
    const python = needActive();
    if (typeof name !== 'string' || name.length > 200 || !PACKAGE_NAME.test(name)) throw new Error('Invalid package name.');
    if (/^(pip|setuptools|uv)$/i.test(name)) throw new Error(`${name} is needed by the environment and cannot be removed here.`);
    const code = await envs.uninstall(python, name, log);
    return { ok: code === 0, code };
  }));

  ipcMain.handle('py-packages', () => envs.listPackages(needActive()));
  ipcMain.handle('py-check', () => envs.check(needActive()));

  // Older API kept for the run bar: reports the active interpreter
  ipcMain.handle('python-detect', async () => {
    if (!list.length) await refresh();
    return active
      ? { found: true, path: active.path, version: `Python ${active.version}`, label: active.label, kind: active.kind }
      : { found: false };
  });

  // Older streaming pip channel (packages panel, quick installs)
  ipcMain.on('pip-install', async (event, pkg) => {
    const reply = (ch, ...a) => { if (!event.sender.isDestroyed()) event.sender.send(ch, ...a); };
    if (!active) { reply('pip-stdout', 'No Python selected.\n'); return reply('pip-done', 1, pkg); }
    if (!isValidPackageSpec(pkg)) { reply('pip-stdout', 'Invalid package name.\n'); return reply('pip-done', 1, pkg); }
    try {
      const code = await exclusive('installing packages', () => envs.install(active.path, [pkg], (t) => reply('pip-stdout', t), { cwd: getRoot() || undefined }));
      reply('pip-done', code, pkg);
    } catch (err) {
      reply('pip-stdout', `${err.message}\n`);
      reply('pip-done', 1, pkg);
    }
  });

  return {
    envs,
    refresh,
    get active() { return active; },
    /** Environment for shells: the active environment's folder first on PATH. */
    shellEnv(base = process.env) { return active ? envs.activationEnv(active.path, base) : { ...base }; },
  };
}

module.exports = { registerPythonIpc, bundledPaths };

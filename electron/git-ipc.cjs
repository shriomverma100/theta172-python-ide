/**
 * THETA172 — Git IPC (main process).
 *
 * Every path from the editor must be relative to the repository and stay
 * inside it. Untracked files are moved to the Recycle Bin when discarded
 * (never deleted outright).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Git, friendlyGitError } = require('./git.cjs');

const PYTHON_GITIGNORE = [
  '# Python',
  '__pycache__/',
  '*.py[cod]',
  '.pytest_cache/',
  '.mypy_cache/',
  '.ruff_cache/',
  '.ipynb_checkpoints/',
  '',
  '# Environments',
  '.venv/',
  'venv/',
  'env/',
  '.env',
  '',
  '# Editors and systems',
  '.vscode/',
  '.idea/',
  '.DS_Store',
  'Thumbs.db',
  '',
].join('\n');

function registerGitIpc({ ipcMain, execFile, shell, getRoot }) {
  const git = new Git({ execFile, getRoot });
  let version;

  const inside = (rel) => {
    if (!git.top || typeof rel !== 'string' || !rel || rel.includes('\0') || path.isAbsolute(rel) || rel.length > 4096) return null;
    const abs = path.resolve(git.top, rel);
    const top = path.resolve(git.top);
    const ok = process.platform === 'win32'
      ? abs.toLowerCase().startsWith(`${top.toLowerCase()}${path.sep}`)
      : abs.startsWith(`${top}${path.sep}`);
    return ok ? abs : null;
  };
  const files = (list) => {
    if (!Array.isArray(list) || !list.length || list.length > 5000) throw new Error('No files given.');
    const clean = list.map((f) => String(f).replace(/\\/g, '/'));
    if (!clean.every(inside)) throw new Error('A file is outside the repository.');
    return clean;
  };
  const result = (r, extra = {}) => (r.ok ? { ok: true, ...extra } : { ok: false, error: friendlyGitError(r.stderr) });

  ipcMain.handle('git-status', async () => {
    if (version === undefined) version = await git.available();
    if (!version) return { available: false };
    if (!getRoot()) return { available: true, version, repo: null };
    return { available: true, version, repo: await git.status() };
  });

  ipcMain.handle('git-show', async (_e, file, rev) => {
    await git.findTop();
    const [f] = files([file]);
    return git.show(rev === 'HEAD' ? 'HEAD' : '', f);
  });

  // The file as it is on disk now ('' if deleted); text only, up to 5 MB
  ipcMain.handle('git-read-working', async (_e, file) => {
    await git.findTop();
    const [f] = files([file]);
    try {
      const st = await fs.promises.stat(inside(f));
      if (st.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.');
      return await fs.promises.readFile(inside(f), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return '';
      throw err;
    }
  });

  ipcMain.handle('git-stage', async (_e, list) => { await git.findTop(); return result(await git.stage(files(list))); });
  ipcMain.handle('git-unstage', async (_e, list) => { await git.findTop(); return result(await git.unstage(files(list))); });

  ipcMain.handle('git-discard', async (_e, list) => {
    const status = await git.status();
    if (!status) return { ok: false, error: 'This folder is not a git repository.' };
    const wanted = new Set(files(list));
    const untracked = status.files.filter((f) => f.kind === 'untracked' && wanted.has(f.path)).map((f) => f.path);
    const tracked = [...wanted].filter((f) => !untracked.includes(f));
    for (const f of untracked) await shell.trashItem(inside(f));
    if (tracked.length) return result(await git.discard(tracked), { trashed: untracked.length });
    return { ok: true, trashed: untracked.length };
  });

  ipcMain.handle('git-commit', async (_e, message, opts = {}) => {
    await git.findTop();
    if (typeof message !== 'string' || !message.trim() || message.length > 20000) return { ok: false, error: 'Write a commit message first.' };
    return result(await git.commit(message.trim(), { amend: !!opts.amend, all: !!opts.all }));
  });

  ipcMain.handle('git-branches', async () => { await git.findTop(); return git.branches(); });

  ipcMain.handle('git-checkout', async (_e, opts = {}) => {
    await git.findTop();
    if (opts.track) {
      const { remote } = await git.branches();
      if (!remote.some((b) => b.name === opts.track)) return { ok: false, error: 'That remote branch no longer exists.' };
      return result(await git.checkout(null, { track: opts.track }));
    }
    if (!(await git.validBranchName(opts.name))) return { ok: false, error: 'That is not a valid branch name.' };
    return result(await git.checkout(opts.name, { create: !!opts.create }));
  });

  ipcMain.handle('git-log', async (_e, limit) => { await git.findTop(); return git.log(Number(limit) || 40); });
  ipcMain.handle('git-pull', async () => { await git.findTop(); return result(await git.pull()); });
  ipcMain.handle('git-fetch', async () => { await git.findTop(); return result(await git.fetch()); });
  ipcMain.handle('git-push', async () => {
    const status = await git.status();
    if (!status?.branch) return { ok: false, error: 'Check out a branch before pushing.' };
    return result(await git.push(status.branch, !!status.upstream));
  });
  ipcMain.handle('git-init', async () => {
    const root = getRoot();
    if (!root) return { ok: false, error: 'Open a folder first.' };
    const res = await git.init();
    // A Python project shouldn't track caches and environments: add a .gitignore unless there is one
    const ignore = path.join(root, '.gitignore');
    if (res.ok && !fs.existsSync(ignore)) {
      try { fs.writeFileSync(ignore, PYTHON_GITIGNORE); } catch (_) { /* optional */ }
    }
    return result(res);
  });
  ipcMain.handle('git-identity', async () => { await git.findTop(); return git.identity(); });
  ipcMain.handle('git-set-identity', async (_e, name, email) => {
    const n = String(name || '').trim();
    const m = String(email || '').trim();
    if (!n || n.length > 100 || !/^[^\s@]+@[^\s@]+$/.test(m) || m.length > 200) return { ok: false, error: 'Enter your name and a valid email.' };
    await git.setIdentity(n, m);
    return { ok: true };
  });

  return { git };
}

module.exports = { registerGitIpc };

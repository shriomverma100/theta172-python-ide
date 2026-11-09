/**
 * THETA172 — Git (main process).
 *
 * Runs the user's git with argument arrays (never a shell), file paths after
 * "--", and terminal prompts off so nothing can hang waiting for input
 * (Git Credential Manager shows its own window for sign-in).
 * Paths are relative to the repository's top folder, with "/" separators.
 */

'use strict';

const path = require('path');

const RECORD = '\x1e';
const FIELD = '\x1f';

class Git {
  /**
   * @param {object} deps
   * @param {Function} deps.execFile
   * @param {() => string|null} deps.getRoot   the open folder
   * @param {object} [deps.env]
   */
  constructor({ execFile, getRoot, env = process.env }) {
    this._execFile = execFile;
    this._getRoot = getRoot;
    this._env = { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GCM_INTERACTIVE: 'auto' };
    this.top = null; // repository top folder for the current root
  }

  run(args, { cwd, timeout = 20000 } = {}) {
    return new Promise((resolve) => {
      this._execFile('git', ['-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args], {
        cwd: cwd || this.top || this._getRoot() || undefined,
        timeout,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        env: this._env,
      }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '').trim(),
          missing: !!err && err.code === 'ENOENT',
        });
      });
    });
  }

  async available() {
    const r = await this.run(['--version'], { cwd: process.cwd() });
    return r.ok ? r.stdout.trim().replace(/^git version /, '') : null;
  }

  /** The repository top folder for the open folder, or null when it isn't a repository. */
  async findTop() {
    const root = this._getRoot();
    if (!root) { this.top = null; return null; }
    const r = await this.run(['rev-parse', '--show-toplevel'], { cwd: root });
    this.top = r.ok ? path.resolve(r.stdout.trim()) : null;
    return this.top;
  }

  /**
   * Parse `git status --porcelain=v2 --branch -z`.
   * @returns {{ branch, oid, upstream, ahead, behind, files: Array<{ path, orig?, staged, unstaged, kind }> }}
   *   staged/unstaged: one letter (M A D R C T U) or null; kind: 'tracked' | 'untracked' | 'conflict'
   */
  static parseStatus(out) {
    const result = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, files: [] };
    const parts = out.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const line = parts[i];
      if (!line) continue;
      if (line.startsWith('# ')) {
        const [, key, ...rest] = line.split(' ');
        const value = rest.join(' ');
        if (key === 'branch.head') result.branch = value === '(detached)' ? null : value;
        else if (key === 'branch.oid') result.oid = value === '(initial)' ? null : value;
        else if (key === 'branch.upstream') result.upstream = value;
        else if (key === 'branch.ab') {
          const m = /\+(\d+) -(\d+)/.exec(value);
          if (m) { result.ahead = Number(m[1]); result.behind = Number(m[2]); }
        }
        continue;
      }
      const type = line[0];
      const letter = (c) => (c === '.' ? null : c);
      if (type === '1') {
        const f = line.split(' ');
        result.files.push({ path: f.slice(8).join(' '), staged: letter(f[1][0]), unstaged: letter(f[1][1]), kind: 'tracked' });
      } else if (type === '2') {
        const f = line.split(' ');
        const orig = parts[++i]; // renamed: the original path follows
        result.files.push({ path: f.slice(9).join(' '), orig, staged: letter(f[1][0]), unstaged: letter(f[1][1]), kind: 'tracked' });
      } else if (type === 'u') {
        const f = line.split(' ');
        result.files.push({ path: f.slice(10).join(' '), staged: null, unstaged: 'U', kind: 'conflict' });
      } else if (type === '?') {
        result.files.push({ path: line.slice(2), staged: null, unstaged: 'A', kind: 'untracked' });
      }
    }
    return result;
  }

  async status() {
    if (!(await this.findTop())) return null;
    const r = await this.run(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    if (!r.ok) return null;
    return { top: this.top, ...Git.parseStatus(r.stdout) };
  }

  /** File text at HEAD (rev 'HEAD') or in the index (rev ''); '' when it doesn't exist there. */
  async show(rev, file) {
    const r = await this.run(['show', `${rev}:${file}`]);
    return r.ok ? r.stdout : '';
  }

  stage(files) { return this.run(['add', '--', ...files]); }

  async unstage(files) {
    // Before the first commit there is no HEAD to restore from
    const head = await this.run(['rev-parse', '--verify', '-q', 'HEAD']);
    return head.ok ? this.run(['restore', '--staged', '--', ...files]) : this.run(['rm', '--cached', '-q', '--', ...files]);
  }

  /** Throw away working-tree edits to tracked files (untracked files are trashed by the caller). */
  discard(files) { return this.run(['restore', '--worktree', '--', ...files]); }

  commit(message, { amend = false, all = false } = {}) {
    return this.run(['commit', ...(all ? ['-a'] : []), ...(amend ? ['--amend'] : []), '-m', message], { timeout: 60000 });
  }

  static parseRefs(out) {
    const local = [];
    const remote = [];
    let current = null;
    for (const rec of out.split('\n')) {
      if (!rec.trim()) continue;
      const [name, head, upstream] = rec.split(FIELD);
      if (name.startsWith('refs/heads/')) {
        const short = name.slice('refs/heads/'.length);
        local.push({ name: short, upstream: upstream || null });
        if (head === '*') current = short;
      } else if (name.startsWith('refs/remotes/') && !name.endsWith('/HEAD')) {
        remote.push({ name: name.slice('refs/remotes/'.length) });
      }
    }
    return { current, local, remote };
  }

  async branches() {
    const r = await this.run(['for-each-ref', `--format=%(refname)${FIELD}%(HEAD)${FIELD}%(upstream:short)`, 'refs/heads', 'refs/remotes']);
    return Git.parseRefs(r.stdout);
  }

  /** A name git accepts for a branch. */
  async validBranchName(name) {
    if (typeof name !== 'string' || !name || name.length > 200 || name.startsWith('-')) return false;
    return (await this.run(['check-ref-format', '--branch', name])).ok;
  }

  checkout(name, { create = false, track = null } = {}) {
    if (track) return this.run(['switch', '--track', track]);
    return this.run(['switch', ...(create ? ['-c'] : []), name]);
  }

  static parseLog(out) {
    return out.split(RECORD).map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
      const [hash, short, author, date, subject] = r.split(FIELD);
      return { hash, short, author, date, subject };
    });
  }

  async log(limit = 40) {
    const r = await this.run(['log', `-n${Math.min(200, Math.max(1, limit))}`, `--pretty=format:%H${FIELD}%h${FIELD}%an${FIELD}%ar${FIELD}%s${RECORD}`]);
    return r.ok ? Git.parseLog(r.stdout) : [];
  }

  pull() { return this.run(['pull', '--ff-only'], { timeout: 120000 }); }
  fetch() { return this.run(['fetch', '--prune'], { timeout: 120000 }); }

  async push(branch, hasUpstream) {
    if (hasUpstream) return this.run(['push'], { timeout: 120000 });
    const remotes = await this.run(['remote']);
    const remote = remotes.stdout.split('\n').map((s) => s.trim()).filter(Boolean)[0];
    if (!remote) return { ok: false, stderr: 'This repository has no remote to push to. Add one with: git remote add origin <url>' };
    return this.run(['push', '-u', remote, branch], { timeout: 120000 });
  }

  /** New repositories start on "main" unless the user chose another default (init.defaultBranch). */
  async init() {
    const cwd = this._getRoot();
    const preferred = (await this.run(['config', '--get', 'init.defaultBranch'], { cwd })).stdout.trim();
    return this.run(['init', '-b', preferred || 'main'], { cwd });
  }

  async identity() {
    const [name, email] = await Promise.all([this.run(['config', 'user.name']), this.run(['config', 'user.email'])]);
    return { name: name.stdout.trim() || null, email: email.stdout.trim() || null };
  }

  setIdentity(name, email) {
    return Promise.all([
      this.run(['config', '--global', 'user.name', name]),
      this.run(['config', '--global', 'user.email', email]),
    ]);
  }
}

/** Git's error text, shortened to what a person needs (hints and prefixes removed). */
function friendlyGitError(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).filter((l) => l && !/^hint:/.test(l));
  const text = lines.join('\n').replace(/^(error|fatal): /gm, '').trim();
  if (/Please tell me who you are|user\.email|empty ident/i.test(text)) return 'IDENTITY';
  if (/nothing to commit/i.test(text)) return 'There is nothing to commit. Stage some changes first.';
  if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(text)) return 'Git could not sign in to the remote. Sign in with Git Credential Manager, then try again.';
  if (/Not possible to fast-forward|diverging branches|non-fast-forward|rejected/i.test(text)) return 'Your branch and the remote have both changed. Pull first, or merge them in the Shell.';
  return lines.slice(-3).join('\n').replace(/^(error|fatal): /gm, '') || 'Git failed.';
}

module.exports = { Git, friendlyGitError };

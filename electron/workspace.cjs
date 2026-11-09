/**
 * THETA172 — Workspace (main process).
 *
 * A workspace is one folder the user opened with a native dialog. Every
 * file operation the renderer asks for is checked to stay INSIDE that
 * folder, so a compromised renderer cannot read or write anywhere else.
 * Deleting moves to the Recycle Bin / Trash, never a hard delete.
 */

'use strict';

const path = require('path');

/** Folders that are shown but never searched or expanded automatically. */
const HEAVY_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env', '.mypy_cache', '.pytest_cache', '.ipynb_checkpoints', '.ruff_cache', 'dist', 'build']);
const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_MATCHES = 2000;
const MAX_SEARCH_FILES = 5000;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

class WorkspaceError extends Error {}

class Workspace {
  /**
   * @param {object} deps
   * @param {object} deps.fs        node:fs (promises API used via fs.promises)
   * @param {Function} [deps.trash] (absPath) => Promise<void>; moves to the bin
   * @param {Function} [deps.execFile] child_process.execFile (for git)
   * @param {string} [deps.platform]
   */
  constructor({ fs, trash, execFile, platform = process.platform }) {
    this._fs = fs;
    this._fsp = fs.promises;
    this._trash = trash;
    this._execFile = execFile;
    this._path = platform === 'win32' ? path.win32 : path.posix;
    this._caseInsensitive = platform === 'win32' || platform === 'darwin';
    this.root = null;
  }

  // ── Paths ─────────────────────────────────────────────────────
  _norm(p) {
    const r = this._path.resolve(p);
    return this._caseInsensitive ? r.toLowerCase() : r;
  }

  /** True when `p` is the root or inside it. */
  contains(p) {
    if (!this.root || typeof p !== 'string' || !p) return false;
    const rel = this._path.relative(this._norm(this.root), this._norm(p));
    return rel === '' || (!rel.startsWith('..') && !this._path.isAbsolute(rel));
  }

  /** Resolve and check a renderer-supplied path. Throws when outside. */
  _inside(p) {
    if (!this.root) throw new WorkspaceError('No folder is open.');
    if (typeof p !== 'string' || !p) throw new WorkspaceError('Invalid path.');
    const abs = this._path.resolve(p);
    if (!this.contains(abs)) throw new WorkspaceError('That path is outside the open folder.');
    return abs;
  }

  relative(p) {
    return this._path.relative(this.root, p);
  }

  /** A single file or folder name: no separators, no "..", no reserved names. */
  static validName(name) {
    return typeof name === 'string'
      && name.trim() === name
      && name.length > 0
      && name.length <= 255
      && !/[\\/:*?"<>|\x00-\x1f]/.test(name)
      && name !== '.' && name !== '..'
      && !/[. ]$/.test(name)
      && !WINDOWS_RESERVED.test(name);
  }

  _checkName(name) {
    if (!Workspace.validName(name)) throw new WorkspaceError(`"${name}" is not a valid name.`);
  }

  // ── Open ──────────────────────────────────────────────────────
  async setRoot(dir) {
    const abs = this._path.resolve(dir);
    const st = await this._fsp.stat(abs);
    if (!st.isDirectory()) throw new WorkspaceError('Not a folder.');
    this.root = abs;
    return { root: abs, name: this._path.basename(abs) || abs };
  }

  close() {
    this.root = null;
  }

  // ── Read the tree ─────────────────────────────────────────────
  async list(dir) {
    const abs = this._inside(dir || this.root);
    const entries = await this._fsp.readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() || e.isFile())
      .map((e) => ({
        name: e.name,
        path: this._path.join(abs, e.name),
        type: e.isDirectory() ? 'dir' : 'file',
        heavy: e.isDirectory() && HEAVY_DIRS.has(e.name),
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) : a.type === 'dir' ? -1 : 1));
  }

  async read(file) {
    const abs = this._inside(file);
    const st = await this._fsp.stat(abs);
    if (!st.isFile()) throw new WorkspaceError('Not a file.');
    if (st.size > MAX_READ_BYTES) throw new WorkspaceError('File is larger than 5 MB.');
    const buf = await this._fsp.readFile(abs);
    if (buf.includes(0)) throw new WorkspaceError('This looks like a binary file.');
    return buf.toString('utf8');
  }

  async write(file, content) {
    const abs = this._inside(file);
    if (typeof content !== 'string') throw new WorkspaceError('Invalid content.');
    await this._fsp.writeFile(abs, content, 'utf8');
    return abs;
  }

  // ── Change the tree ───────────────────────────────────────────
  async create(parentDir, name, type) {
    const parent = this._inside(parentDir || this.root);
    this._checkName(name);
    const abs = this._inside(this._path.join(parent, name));
    if (type === 'dir') await this._fsp.mkdir(abs);
    else await this._fsp.writeFile(abs, '', { encoding: 'utf8', flag: 'wx' }); // fail if it exists
    return abs;
  }

  async rename(p, newName) {
    const abs = this._inside(p);
    if (this._norm(abs) === this._norm(this.root)) throw new WorkspaceError('Cannot rename the project folder here.');
    this._checkName(newName);
    const dest = this._inside(this._path.join(this._path.dirname(abs), newName));
    if (this._norm(dest) !== this._norm(abs) && (await exists(this._fsp, dest))) throw new WorkspaceError(`"${newName}" already exists.`);
    await this._fsp.rename(abs, dest);
    return dest;
  }

  async move(p, destDir) {
    const abs = this._inside(p);
    const dir = this._inside(destDir);
    if (this._norm(abs) === this._norm(this.root)) throw new WorkspaceError('Cannot move the project folder.');
    // Never into itself or its own children
    const rel = this._path.relative(this._norm(abs), this._norm(dir));
    if (rel === '' || (!rel.startsWith('..') && !this._path.isAbsolute(rel))) throw new WorkspaceError('Cannot move a folder into itself.');
    const dest = this._path.join(dir, this._path.basename(abs));
    if (this._norm(dest) === this._norm(abs)) return abs;
    if (await exists(this._fsp, dest)) throw new WorkspaceError(`"${this._path.basename(abs)}" already exists there.`);
    await this._fsp.rename(abs, dest);
    return dest;
  }

  async remove(p) {
    const abs = this._inside(p);
    if (this._norm(abs) === this._norm(this.root)) throw new WorkspaceError('Cannot delete the project folder.');
    if (!this._trash) throw new WorkspaceError('Recycle Bin is not available.');
    await this._trash(abs);
    return abs;
  }

  // ── Search & replace ──────────────────────────────────────────
  /** Every text file under the root, skipping heavy folders. */
  async _walk() {
    const out = [];
    const stack = [this.root];
    while (stack.length && out.length < MAX_SEARCH_FILES) {
      const dir = stack.pop();
      let entries;
      try { entries = await this._fsp.readdir(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of entries) {
        const p = this._path.join(dir, e.name);
        if (e.isDirectory()) { if (!HEAVY_DIRS.has(e.name)) stack.push(p); }
        else if (e.isFile()) out.push(p);
      }
    }
    return out.sort();
  }

  static buildMatcher(query, { regex = false, matchCase = false, wholeWord = false } = {}) {
    if (typeof query !== 'string' || !query) throw new WorkspaceError('Type something to search for.');
    let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) source = `\\b(?:${source})\\b`;
    try {
      return new RegExp(source, matchCase ? 'g' : 'gi');
    } catch (err) {
      throw new WorkspaceError(`Invalid regular expression: ${err.message}`);
    }
  }

  async _readText(file) {
    try {
      const st = await this._fsp.stat(file);
      if (st.size > MAX_SEARCH_FILE_BYTES) return null;
      const buf = await this._fsp.readFile(file);
      if (buf.includes(0)) return null;
      return buf.toString('utf8');
    } catch (_) {
      return null;
    }
  }

  async search(query, opts = {}) {
    if (!this.root) throw new WorkspaceError('No folder is open.');
    const re = Workspace.buildMatcher(query, opts);
    const results = [];
    let total = 0;
    for (const file of await this._walk()) {
      const text = await this._readText(file);
      if (text == null) continue;
      const matches = [];
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && total < MAX_SEARCH_MATCHES; i++) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(lines[i])) && total < MAX_SEARCH_MATCHES) {
          if (m[0] === '') { re.lastIndex++; continue; }
          matches.push({ line: i + 1, col: m.index + 1, length: m[0].length, text: lines[i].slice(0, 400) });
          total++;
        }
      }
      if (matches.length) results.push({ path: file, rel: this.relative(file), matches });
      if (total >= MAX_SEARCH_MATCHES) break;
    }
    return { results, total, truncated: total >= MAX_SEARCH_MATCHES };
  }

  /**
   * Replace in every matching file except those in `skip` (files with
   * unsaved changes open in the editor). Returns the files it changed.
   */
  async replaceAll(query, replacement, opts = {}, skip = []) {
    if (!this.root) throw new WorkspaceError('No folder is open.');
    if (typeof replacement !== 'string') throw new WorkspaceError('Invalid replacement.');
    const re = Workspace.buildMatcher(query, opts);
    const skipped = new Set(skip.filter((p) => typeof p === 'string').map((p) => this._norm(p)));
    const changed = [];
    let count = 0;
    for (const file of await this._walk()) {
      if (skipped.has(this._norm(file))) continue;
      const text = await this._readText(file);
      if (text == null) continue;
      const n = (text.match(re) || []).filter((m) => m !== '').length;
      if (n === 0) continue;
      // $1, $2 … mean capture groups only in regex mode; otherwise literal
      const rep = opts.regex ? replacement : replacement.replace(/\$/g, '$$$$');
      const next = text.replace(re, rep);
      if (next !== text) {
        await this._fsp.writeFile(file, next, 'utf8');
        changed.push(file);
        count += n;
      }
    }
    return { changed, count };
  }

  // ── Git ───────────────────────────────────────────────────────
  /** { branch, files: { relPath: 'M'|'A'|'D'|'U'|'R' } } or null if not a repo. */
  gitStatus() {
    if (!this.root || !this._execFile) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._execFile('git', ['status', '--porcelain=v1', '-b', '--untracked-files=normal'], { cwd: this.root, timeout: 4000, windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        resolve(Workspace.parseGitStatus(String(stdout)));
      });
    });
  }

  static parseGitStatus(out) {
    const files = {};
    let branch = null;
    for (const line of out.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith('## ')) {
        branch = line.slice(3).split('...')[0].replace(/^No commits yet on /, '').trim();
        continue;
      }
      const xy = line.slice(0, 2);
      let file = line.slice(3);
      if (file.includes(' -> ')) file = file.split(' -> ')[1];
      file = file.replace(/^"|"$/g, '');
      const code = xy === '??' ? 'U' : xy.includes('D') ? 'D' : xy.includes('A') ? 'A' : xy.includes('R') ? 'R' : 'M';
      files[file.replace(/\//g, path.sep === '\\' ? '\\' : '/')] = code;
    }
    return { branch, files };
  }
}

async function exists(fsp, p) {
  try { await fsp.access(p); return true; } catch (_) { return false; }
}

module.exports = { Workspace, WorkspaceError, HEAVY_DIRS };

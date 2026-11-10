/**
 * THETA172 — Class package cache (the "offline classroom mesh").
 *
 * The teacher's laptop downloads packages once (pandas, numpy, matplotlib …)
 * into a class folder and serves them on the local network. Students' apps
 * install from the teacher first, so forty students don't each download
 * pandas, and installing works in a lab with no internet at all. Python
 * itself ships inside the app, so only packages need sharing.
 *
 * Read-only HTTP: GET /simple/ is a "find-links" page listing the wheels
 * with their SHA-256 (pip and uv check every download against it);
 * GET /files/<name> serves one file from the folder. Nothing else.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const FILE_RE = /^[\w.+-]+\.(whl|tar\.gz|zip)$/;

class PackageCache {
  /**
   * @param {object} deps
   * @param {string} deps.dir        the class package folder
   * @param {Function} deps.spawn
   * @param {() => string|null} deps.getPython  a Python with pip (the bundled one)
   */
  constructor({ dir, spawn, getPython }) {
    Object.assign(this, { dir, spawn, getPython });
    this.server = null;
    this.port = null;
    this.hashes = new Map(); // file name -> { size, mtime, sha256 }
    this.busy = false;
  }

  ensureDir() { fs.mkdirSync(this.dir, { recursive: true }); }

  /** Wheels in the folder: [{ name, size, sha256 }] */
  list() {
    this.ensureDir();
    const out = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!FILE_RE.test(name)) continue;
      const full = path.join(this.dir, name);
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (!st.isFile()) continue;
      let h = this.hashes.get(name);
      if (!h || h.size !== st.size || h.mtime !== st.mtimeMs) {
        h = { size: st.size, mtime: st.mtimeMs, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') };
        this.hashes.set(name, h);
      }
      out.push({ name, size: st.size, sha256: h.sha256 });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  summary() {
    const files = this.list();
    const names = [...new Set(files.map((f) => f.name.split('-')[0].replace(/_/g, '-').toLowerCase()))];
    return { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0), packages: names, port: this.port, busy: this.busy };
  }

  /**
   * Download packages (and what they need) into the folder, as wheels.
   * @param {string[]} specs  package names, e.g. ["pandas", "matplotlib==3.9.2"]
   * @param {(text: string) => void} onLog
   * @returns {Promise<number>} pip's exit code
   */
  prepare(specs, onLog) {
    const python = this.getPython();
    if (!python) return Promise.reject(new Error('No Python found to download with.'));
    const clean = specs.map((s) => String(s).trim()).filter((s) => /^[A-Za-z0-9][\w.\-[\]<>=!~, ]{0,120}$/.test(s));
    if (!clean.length) return Promise.reject(new Error('Type package names, e.g. pandas numpy matplotlib'));
    if (this.busy) return Promise.reject(new Error('Already downloading.'));
    this.ensureDir();
    this.busy = true;
    return new Promise((resolve) => {
      const proc = this.spawn(python, ['-m', 'pip', 'download', ...clean, '-d', this.dir, '--only-binary=:all:', '--disable-pip-version-check', '--no-input'], {
        windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      const log = (b) => onLog?.(b.toString());
      proc.stdout?.on('data', log);
      proc.stderr?.on('data', log);
      proc.on('error', (err) => { this.busy = false; onLog?.(`${err.message}\n`); resolve(1); });
      proc.on('close', (code) => { this.busy = false; resolve(code ?? 1); });
    });
  }

  /** Remove every file from the class folder. */
  clear() {
    for (const f of this.list()) { try { fs.unlinkSync(path.join(this.dir, f.name)); } catch (_) { /* in use */ } }
    this.hashes.clear();
  }

  /** Serve the folder on the local network. Resolves with the port. */
  serve() {
    if (this.server) return Promise.resolve(this.port);
    this.ensureDir();
    const server = http.createServer((req, res) => this._handle(req, res));
    server.on('clientError', (_err, socket) => { try { socket.destroy(); } catch (_) { /* gone */ } });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', () => {
        this.server = server;
        this.port = server.address().port;
        resolve(this.port);
      });
    });
  }

  stop() {
    try { this.server?.close(); } catch (_) { /* gone */ }
    this.server = null;
    this.port = null;
  }

  _handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/simple/' || url === '/simple' || url === '/') {
      const links = this.list().map((f) => `<a href="/files/${encodeURIComponent(f.name)}#sha256=${f.sha256}">${f.name}</a><br>`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><html><body>\n${links}\n</body></html>\n`);
      return;
    }
    const m = /^\/files\/([^/]+)$/.exec(url);
    if (!m || !FILE_RE.test(m[1])) { res.writeHead(404).end(); return; }
    const full = path.join(this.dir, m[1]);
    if (path.dirname(full) !== path.resolve(this.dir) || !fs.existsSync(full)) { res.writeHead(404).end(); return; }
    const size = fs.statSync(full).size;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).pipe(res);
  }
}

/** pip/uv arguments to install from a teacher first: --no-index --find-links <url> */
function mirrorArgs(url) {
  return url ? ['--no-index', '--find-links', url] : [];
}

module.exports = { PackageCache, mirrorArgs, FILE_RE };

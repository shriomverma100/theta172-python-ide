/**
 * THETA172 — Python environments (main process).
 *
 * - A portable CPython and uv ship inside the app (scripts/fetch-python.cjs).
 * - On first start a "default" environment is created from it in userData,
 *   so students never install into (or depend on) a system Python.
 * - Discovery finds: the project's .venv/venv, the default environment,
 *   the bundled Python, Python installs from the Windows py launcher and
 *   PATH (skipping the Microsoft Store stub), and conda environments.
 * - Package installs, lists, uninstalls and checks use uv when available
 *   (much faster), else pip.
 * Only interpreters this module discovered can be selected, so the renderer
 * can never make the app execute an arbitrary program.
 */

'use strict';

const path = require('path');

const INSPECT = 'import json,sys,platform;print(json.dumps({"version":platform.python_version(),"executable":sys.executable,"prefix":sys.prefix,"base_prefix":sys.base_prefix,"impl":platform.python_implementation(),"bits":64 if sys.maxsize>2**32 else 32}))';
const PROJECT_ENV_DIRS = ['.venv', 'venv', 'env'];

class PythonEnvironments {
  /**
   * @param {object} deps
   * @param {Function} deps.execFile  child_process.execFile
   * @param {Function} deps.spawn     child_process.spawn
   * @param {object}   deps.fs
   * @param {string}   deps.userData  app.getPath('userData')
   * @param {{ python: string|null, uv: string|null }} deps.bundled  absolute paths (may be missing)
   * @param {string}   [deps.platform]
   * @param {object}   [deps.env]
   */
  constructor({ execFile, spawn, fs, userData, bundled, platform = process.platform, env = process.env }) {
    this._execFile = execFile;
    this._spawn = spawn;
    this._fs = fs;
    this._platform = platform;
    this._env = env;
    this._path = platform === 'win32' ? path.win32 : path.posix;
    this.bundled = bundled;
    this.defaultEnvDir = this._path.join(userData, 'python-envs', 'default');
    this._stateFile = this._path.join(userData, 'python.json');
    this._state = this._loadState();
    this._known = new Map(); // normalised exe path -> interpreter info
    this._inspected = new Map(); // normalised exe path -> { stamp, info }
  }

  // ── Small helpers ─────────────────────────────────────────────
  _exists(p) { try { return !!p && this._fs.existsSync(p); } catch (_) { return false; } }
  _key(p) { const r = this._path.resolve(p); return this._platform === 'win32' ? r.toLowerCase() : r; }

  /** The python executable inside a venv folder. */
  envPython(dir) {
    return this._platform === 'win32' ? this._path.join(dir, 'Scripts', 'python.exe') : this._path.join(dir, 'bin', 'python');
  }

  _run(file, args, { timeout = 10000, cwd } = {}) {
    return new Promise((resolve) => {
      this._execFile(file, args, { timeout, cwd, windowsHide: true, env: { ...this._env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  }

  /** Stream a command's output to onLog; resolves with the exit code. */
  _stream(file, args, onLog, { cwd } = {}) {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = this._spawn(file, args, { cwd, windowsHide: true, env: { ...this._env, PYTHONIOENCODING: 'utf-8', UV_NO_PROGRESS: '1' } });
      } catch (err) {
        onLog?.(`${err.message}\n`);
        return resolve(1);
      }
      proc.stdout?.on('data', (d) => onLog?.(d.toString()));
      proc.stderr?.on('data', (d) => onLog?.(d.toString()));
      proc.on('error', (err) => { onLog?.(`${err.message}\n`); resolve(1); });
      proc.on('close', (code) => resolve(code ?? 1));
    });
  }

  _loadState() {
    try {
      const s = JSON.parse(this._fs.readFileSync(this._stateFile, 'utf8'));
      return { global: typeof s.global === 'string' ? s.global : null, perProject: s.perProject && typeof s.perProject === 'object' ? s.perProject : {} };
    } catch (_) {
      return { global: null, perProject: {} };
    }
  }

  _saveState() {
    try {
      this._fs.mkdirSync(this._path.dirname(this._stateFile), { recursive: true });
      this._fs.writeFileSync(this._stateFile, JSON.stringify(this._state, null, 2));
    } catch (_) { /* best effort */ }
  }

  // ── Inspect & discover ────────────────────────────────────────
  /**
   * Version and layout of a Python. Results are cached by path and file
   * time, so refreshing the list does not start every Python again.
   */
  async inspect(exe) {
    let stamp;
    try {
      const st = this._fs.statSync(exe);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch (_) {
      return null;
    }
    const k = this._key(exe);
    const hit = this._inspected.get(k);
    if (hit && hit.stamp === stamp) return hit.info;
    const res = await this._run(exe, ['-c', INSPECT], { timeout: 8000 });
    let info = null;
    if (res.ok) {
      try {
        const raw = JSON.parse(res.stdout.trim().split(/\r?\n/).pop());
        info = { ...raw, isVenv: raw.prefix !== raw.base_prefix };
      } catch (_) { /* not Python */ }
    }
    this._inspected.set(k, { stamp, info });
    return info;
  }

  /** Parse `py -0p`: lines like " -V:3.12 *        C:\…\python.exe" */
  static parsePyLauncher(out) {
    return out.split(/\r?\n/)
      .map((l) => l.match(/^\s*-V?:?\S+\s+\*?\s*(.+\.exe)\s*$/i))
      .filter(Boolean)
      .map((m) => m[1].trim());
  }

  /** The Microsoft Store "python.exe" stub opens the Store instead of running Python. */
  static isStoreStub(p) {
    return /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(p);
  }

  async _systemCandidates() {
    const found = [];
    if (this._platform === 'win32') {
      const py = await this._run('py', ['-0p'], { timeout: 5000 });
      if (py.ok) found.push(...PythonEnvironments.parsePyLauncher(py.stdout));
      const where = await this._run('where', ['python'], { timeout: 5000 });
      if (where.ok) found.push(...where.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    } else {
      for (const name of ['python3', 'python']) {
        const which = await this._run('which', ['-a', name], { timeout: 5000 });
        if (which.ok) found.push(...which.stdout.split(/\n/).map((s) => s.trim()).filter(Boolean));
      }
    }
    return found.filter((p) => !PythonEnvironments.isStoreStub(p));
  }

  async _condaCandidates() {
    const res = await this._run('conda', ['env', 'list', '--json'], { timeout: 6000 });
    if (!res.ok) return [];
    try {
      return (JSON.parse(res.stdout).envs || []).map((dir) => ({
        exe: this._platform === 'win32' ? this._path.join(dir, 'python.exe') : this._path.join(dir, 'bin', 'python'),
        envName: this._path.basename(dir),
      }));
    } catch (_) {
      return [];
    }
  }

  /**
   * Every interpreter we can offer, best first.
   * @param {string|null} projectRoot
   */
  async discover(projectRoot, { rescan = true } = {}) {
    const candidates = [];
    if (projectRoot) {
      for (const d of PROJECT_ENV_DIRS) {
        candidates.push({ exe: this.envPython(this._path.join(projectRoot, d)), kind: 'project', envName: d });
      }
    }
    candidates.push({ exe: this.envPython(this.defaultEnvDir), kind: 'default', envName: 'THETA172 default' });
    if (this.bundled.python) candidates.push({ exe: this.bundled.python, kind: 'bundled' });
    // Installed Pythons rarely change: a project switch reuses the last scan
    if (rescan || !this._scan) {
      const [system, conda] = await Promise.all([this._systemCandidates(), this._condaCandidates()]);
      this._scan = { system, conda };
    }
    const { system, conda } = this._scan;
    for (const exe of system) candidates.push({ exe, kind: 'system' });
    for (const c of conda) candidates.push({ ...c, kind: 'conda' });

    const seen = new Set();
    const unique = candidates.filter((c) => {
      if (!this._exists(c.exe)) return false;
      const k = this._key(c.exe);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const inspected = await Promise.all(unique.map(async (c) => ({ c, info: await this.inspect(c.exe) })));
    const list = inspected.filter((x) => x.info).map(({ c, info }) => ({
      path: c.exe,
      kind: c.kind,
      version: info.version,
      envName: c.envName || null,
      isVenv: info.isVenv,
      label: PythonEnvironments.label(c.kind, c.envName, info.version),
    }));
    this._known = new Map(list.map((i) => [this._key(i.path), i]));
    return list;
  }

  static label(kind, envName, version) {
    switch (kind) {
      case 'project': return `Python ${version} · ${envName} (project)`;
      case 'default': return `Python ${version} · THETA172`;
      case 'bundled': return `Python ${version} · built in`;
      case 'conda': return `Python ${version} · conda ${envName}`;
      default: return `Python ${version}`;
    }
  }

  isKnown(exe) { return typeof exe === 'string' && this._known.has(this._key(exe)); }
  infoFor(exe) { return this._known.get(this._key(exe)) || null; }

  // ── Choosing the active interpreter ───────────────────────────
  /**
   * Order: the user's choice for this project → the project's .venv →
   * the user's global choice → the default environment → built in → any.
   */
  resolveActive(projectRoot, list) {
    const has = (p) => p && list.some((i) => this._key(i.path) === this._key(p));
    const chosen = projectRoot && this._state.perProject[this._key(projectRoot)];
    if (has(chosen)) return this.infoFor(chosen);
    const projectEnv = list.find((i) => i.kind === 'project');
    if (projectEnv) return projectEnv;
    if (has(this._state.global)) return this.infoFor(this._state.global);
    return list.find((i) => i.kind === 'default') || list.find((i) => i.kind === 'bundled') || list[0] || null;
  }

  /** Remember a choice (only interpreters from the last discover()). */
  select(exe, projectRoot) {
    if (!this.isKnown(exe)) throw new Error('That Python is not in the list. Refresh and try again.');
    if (projectRoot) this._state.perProject[this._key(projectRoot)] = exe;
    else this._state.global = exe;
    this._saveState();
    return this.infoFor(exe);
  }

  // ── Creating environments ─────────────────────────────────────
  get hasUv() { return this._exists(this.bundled.uv); }

  /**
   * True when the default environment was made from a Python that is no
   * longer where it was (the app was reinstalled to another folder).
   */
  defaultEnvIsStale() {
    if (!this.bundled.python) return false;
    try {
      const cfg = this._fs.readFileSync(this._path.join(this.defaultEnvDir, 'pyvenv.cfg'), 'utf8');
      const home = /^home\s*=\s*(.+)$/m.exec(cfg)?.[1].trim();
      if (!home) return false;
      return this._key(home) !== this._key(this._path.dirname(this.bundled.python));
    } catch (_) {
      return false;
    }
  }

  /** True when the default environment needs creating or repairing. */
  needsDefaultEnv() {
    return !!this.bundled.python && (!this._exists(this.envPython(this.defaultEnvDir)) || this.defaultEnvIsStale());
  }

  /**
   * Make the default environment from the bundled Python (first start), or
   * point it at the bundled Python again after the app moved. Installed
   * packages are kept.
   */
  async ensureDefaultEnv(onLog) {
    const exe = this.envPython(this.defaultEnvDir);
    if (!this.needsDefaultEnv()) return this._exists(exe) ? exe : null;
    if (!this._exists(this.bundled.python)) return null;
    this._fs.mkdirSync(this._path.dirname(this.defaultEnvDir), { recursive: true });
    const repair = this._exists(exe);
    const code = this.hasUv
      ? await this._stream(this.bundled.uv, ['venv', this.defaultEnvDir, '--python', this.bundled.python, '--seed', '--quiet', ...(repair ? ['--allow-existing'] : [])], onLog)
      : await this._stream(this.bundled.python, ['-m', 'venv', ...(repair ? ['--upgrade'] : []), this.defaultEnvDir], onLog);
    this._inspected.delete(this._key(exe));
    return code === 0 && this._exists(exe) ? exe : null;
  }

  /** Create <project>/.venv from `basePython` (defaults to the bundled one). */
  async createProjectEnv(projectRoot, basePython, onLog) {
    const dir = this._path.join(projectRoot, '.venv');
    const exe = this.envPython(dir);
    if (this._exists(exe)) return exe;
    const base = basePython || this.bundled.python;
    if (!base) throw new Error('No Python to create the environment from.');
    const code = this.hasUv
      ? await this._stream(this.bundled.uv, ['venv', dir, '--python', base, '--seed'], onLog, { cwd: projectRoot })
      : await this._stream(base, ['-m', 'venv', dir], onLog, { cwd: projectRoot });
    if (code !== 0 || !this._exists(exe)) throw new Error('Could not create the environment.');
    return exe;
  }

  // ── Packages ──────────────────────────────────────────────────
  /** Arguments for "pip <command>" through uv (fast) or pip. */
  _pip(python, args) {
    return this.hasUv
      ? { file: this.bundled.uv, args: ['pip', ...args, '--python', python] }
      : { file: python, args: ['-m', 'pip', ...args] };
  }

  install(python, specs, onLog, { cwd } = {}) {
    const { file, args } = this._pip(python, ['install', ...specs]);
    return this._stream(file, args, onLog, { cwd });
  }

  installRequirements(python, requirementsFile, onLog) {
    const { file, args } = this._pip(python, ['install', '-r', requirementsFile]);
    return this._stream(file, args, onLog, { cwd: this._path.dirname(requirementsFile) });
  }

  uninstall(python, name, onLog) {
    const { file, args } = this._pip(python, this.hasUv ? ['uninstall', name] : ['uninstall', '-y', name]);
    return this._stream(file, args, onLog);
  }

  async listPackages(python) {
    const { file, args } = this._pip(python, ['list', '--format', 'json']);
    const res = await this._run(file, args, { timeout: 20000 });
    if (!res.ok) throw new Error((res.stderr || res.stdout).trim() || 'Could not list packages.');
    try {
      return JSON.parse(res.stdout.trim().split(/\r?\n/).filter((l) => l.startsWith('[')).pop() || '[]')
        .map((p) => ({ name: p.name, version: p.version }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } catch (_) {
      return [];
    }
  }

  /** Dependency conflicts, in pip's words. ok=true means none. */
  async check(python) {
    const { file, args } = this._pip(python, ['check']);
    const res = await this._run(file, args, { timeout: 30000 });
    return { ok: res.ok, output: (res.stdout + res.stderr).trim() };
  }

  /** Environment variables that "activate" an environment for a shell or process. */
  activationEnv(python, baseEnv = this._env) {
    const info = this.infoFor(python);
    const bin = this._path.dirname(python);
    const pathKey = Object.keys(baseEnv).find((k) => k.toLowerCase() === 'path') || 'PATH';
    const env = { ...baseEnv, [pathKey]: `${bin}${this._path.delimiter}${baseEnv[pathKey] || ''}` };
    if (info?.isVenv || this._platform !== 'win32') env.VIRTUAL_ENV = this._path.dirname(bin);
    return env;
  }
}

module.exports = { PythonEnvironments, PROJECT_ENV_DIRS };

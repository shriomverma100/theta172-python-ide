import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { missingModule, packageForModule } from '../src/core/module-map.js';

const require = createRequire(import.meta.url);
const { PythonEnvironments } = require('../electron/python-env.cjs');

/**
 * A fake machine: `pythons` maps an executable path to the version it reports.
 * execFile answers the inspect one-liner and the discovery commands.
 */
function fakeMachine({ pythons = {}, pyLauncher = '', where = '', conda = null }) {
  const calls = [];
  const execFile = (file, args, _opts, cb) => {
    calls.push([file, ...args]);
    if (file === 'py') return cb(pyLauncher ? null : new Error('no py'), pyLauncher, '');
    if (file === 'where') return cb(where ? null : new Error('none'), where, '');
    if (file === 'which') return cb(where ? null : new Error('none'), where, '');
    if (file === 'conda') return cb(conda ? null : new Error('no conda'), conda ? JSON.stringify({ envs: conda }) : '', '');
    const version = pythons[file];
    if (!version) return cb(new Error('not python'), '', '');
    const prefix = path.dirname(path.dirname(file));
    const venv = /Scripts|bin/.test(path.basename(path.dirname(file)));
    return cb(null, JSON.stringify({ version, executable: file, prefix, base_prefix: venv ? '/base' : prefix, impl: 'CPython', bits: 64 }), '');
  };
  return { execFile, calls };
}

/** The python inside a venv, laid out the way this OS does it. */
const venvPython = (envDir) => (process.platform === 'win32'
  ? path.join(envDir, 'Scripts', 'python.exe')
  : path.join(envDir, 'bin', 'python'));

let dir;
const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, ''); return p; };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-py-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function make(machine, extra = {}) {
  return new PythonEnvironments({
    execFile: machine.execFile,
    spawn: () => { throw new Error('no spawn in tests'); },
    fs,
    userData: path.join(dir, 'userData'),
    bundled: { python: extra.bundled || null, uv: extra.uv || null },
    platform: process.platform,
    env: { PATH: 'C:\\Windows' },
  });
}

describe('PythonEnvironments: discovery', () => {
  it('reads the py launcher list', () => {
    const out = ' -V:3.12 *        C:\\Python312\\python.exe\n -V:3.11          C:\\Python311\\python.exe\n';
    expect(PythonEnvironments.parsePyLauncher(out)).toEqual(['C:\\Python312\\python.exe', 'C:\\Python311\\python.exe']);
  });

  it('skips the Microsoft Store stub', () => {
    expect(PythonEnvironments.isStoreStub('C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe')).toBe(true);
    expect(PythonEnvironments.isStoreStub('C:\\Python312\\python.exe')).toBe(false);
  });

  it('finds project, default, built-in and system Pythons, best first, without duplicates', async () => {
    const project = path.join(dir, 'proj');
    const venvPy = touch(venvPython(path.join(project, '.venv')));
    const bundled = touch(path.join(dir, 'vendor', 'python', 'python.exe'));
    const system = touch(path.join(dir, 'Python314', 'python.exe'));
    const machine = fakeMachine({
      pythons: { [venvPy]: '3.12.16', [bundled]: '3.12.16', [system]: '3.14.7' },
      pyLauncher: ` -V:3.14 *        ${system}\n`,
      where: `${system}\r\nC:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe\r\n`,
    });
    const envs = make(machine, { bundled });
    const list = await envs.discover(project);
    expect(list.map((i) => i.kind)).toEqual(['project', 'bundled', 'system']);
    expect(list[0]).toMatchObject({ envName: '.venv', isVenv: true, label: 'Python 3.12.16 · .venv (project)' });
    expect(list[2].version).toBe('3.14.7');
  });

  it('ignores files that do not run as Python', async () => {
    const broken = touch(path.join(dir, 'broken', 'python.exe'));
    const envs = make(fakeMachine({ where: broken }));
    expect(await envs.discover(null)).toEqual([]);
  });
});

describe('PythonEnvironments: choosing', () => {
  let envs, list, bundled, system, project, venvPy;
  beforeEach(async () => {
    project = path.join(dir, 'proj');
    venvPy = touch(venvPython(path.join(project, '.venv')));
    bundled = touch(path.join(dir, 'vendor', 'python', 'python.exe'));
    system = touch(path.join(dir, 'Python314', 'python.exe'));
    const defaultPy = touch(venvPython(path.join(dir, 'userData', 'python-envs', 'default')));
    envs = make(fakeMachine({
      pythons: { [venvPy]: '3.12.16', [bundled]: '3.12.16', [system]: '3.14.7', [defaultPy]: '3.12.16' },
      where: system,
    }), { bundled });
    list = await envs.discover(null);
  });

  it('uses the default environment when nothing was chosen', () => {
    expect(envs.resolveActive(null, list).kind).toBe('default');
  });

  it("prefers the project's own .venv", async () => {
    const withProject = await envs.discover(project);
    expect(envs.resolveActive(project, withProject).kind).toBe('project');
  });

  it('remembers a global choice, and a per-project choice over the .venv', async () => {
    envs.select(system, null);
    expect(envs.resolveActive(null, list).path).toBe(system);

    const withProject = await envs.discover(project);
    expect(envs.resolveActive(project, withProject).kind).toBe('project');
    envs.select(bundled, project);
    expect(envs.resolveActive(project, withProject).path).toBe(bundled);

    // persisted for the next start
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'userData', 'python.json'), 'utf8'));
    expect(saved.global).toBe(system);
  });

  it('refuses to select a program it did not discover', () => {
    expect(() => envs.select('C:\\Windows\\System32\\cmd.exe', null)).toThrow(/not in the list/);
  });

  it('activates an environment for shells: its folder first on PATH', () => {
    const env = envs.activationEnv(venvPy, { Path: 'C:\\Windows' });
    expect(env.Path.startsWith(path.dirname(venvPy))).toBe(true);
    expect(env.Path.endsWith('C:\\Windows')).toBe(true);
  });
});

describe('PythonEnvironments: default environment', () => {
  it('needs creating on first start, and repairing after the app moves', () => {
    const bundled = touch(path.join(dir, 'app', 'python', 'python.exe'));
    const envs = make(fakeMachine({}), { bundled });
    expect(envs.needsDefaultEnv()).toBe(true);

    touch(venvPython(envs.defaultEnvDir));
    fs.writeFileSync(path.join(envs.defaultEnvDir, 'pyvenv.cfg'), `home = ${path.dirname(bundled)}\nversion_info = 3.12.16\n`);
    expect(envs.needsDefaultEnv()).toBe(false);

    fs.writeFileSync(path.join(envs.defaultEnvDir, 'pyvenv.cfg'), `home = ${path.join(dir, 'old-install', 'python')}\n`);
    expect(envs.defaultEnvIsStale()).toBe(true);
    expect(envs.needsDefaultEnv()).toBe(true);
  });
});

describe('PythonEnvironments: package commands', () => {
  it('uses uv when it ships with the app, else pip', () => {
    const uv = touch(path.join(dir, 'uv', 'uv.exe'));
    const withUv = make(fakeMachine({}), { uv });
    expect(withUv._pip('C:\\py.exe', ['install', 'numpy'])).toEqual({ file: uv, args: ['pip', 'install', 'numpy', '--python', 'C:\\py.exe'] });
    const noUv = make(fakeMachine({}));
    expect(noUv._pip('C:\\py.exe', ['install', 'numpy'])).toEqual({ file: 'C:\\py.exe', args: ['-m', 'pip', 'install', 'numpy'] });
  });
});

describe('Missing module → package', () => {
  it('reads the module from a traceback', () => {
    expect(missingModule("Traceback...\nModuleNotFoundError: No module named 'sklearn.datasets'\n")).toBe('sklearn');
    expect(missingModule("ModuleNotFoundError: No module named 'pandas'")).toBe('pandas');
    expect(missingModule('NameError: name x is not defined')).toBeNull();
  });

  it('maps import names to the right package', () => {
    expect(packageForModule('cv2').package).toBe('opencv-python');
    expect(packageForModule('sklearn').package).toBe('scikit-learn');
    expect(packageForModule('PIL').package).toBe('pillow');
    expect(packageForModule('numpy').package).toBe('numpy');
  });

  it('never guesses a package for an unknown module', () => {
    const fix = packageForModule('mymodule');
    expect(fix.package).toBeNull();
    expect(fix.hint).toMatch(/mymodule\.py/);
  });
});

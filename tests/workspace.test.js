import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { Workspace } = require('../electron/workspace.cjs');

let dir;
let ws;
let trashed;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-ws-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, '__pycache__'));
  fs.writeFileSync(path.join(dir, 'main.py'), 'from src.helpers import add\nprint(add(1, 2))\n');
  fs.writeFileSync(path.join(dir, 'src', 'helpers.py'), 'def add(a, b):\n    return a + b\n');
  fs.writeFileSync(path.join(dir, '__pycache__', 'x.pyc'), Buffer.from([0, 1, 2]));
  trashed = [];
  ws = new Workspace({ fs, trash: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true }); } });
  await ws.setRoot(dir);
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('Workspace: staying inside the folder', () => {
  it('knows what is inside', () => {
    expect(ws.contains(path.join(dir, 'src', 'helpers.py'))).toBe(true);
    expect(ws.contains(dir)).toBe(true);
    expect(ws.contains(path.join(dir, '..', 'elsewhere.py'))).toBe(false);
    expect(ws.contains(path.join(dir, 'src', '..', '..', 'x.py'))).toBe(false);
    expect(ws.contains(`${dir}-evil${path.sep}x.py`)).toBe(false); // prefix trick
  });

  it('refuses to read or write outside', async () => {
    const outside = path.join(os.tmpdir(), 'theta-outside.py');
    await expect(ws.read(outside)).rejects.toThrow(/outside/);
    await expect(ws.write(outside, 'x')).rejects.toThrow(/outside/);
    await expect(ws.create(dir, '../escape.py', 'file')).rejects.toThrow(/valid name/);
  });

  it('rejects bad names', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'con', 'NUL.txt', 'x?', 'trail.', ' lead']) {
      expect(Workspace.validName(bad), bad).toBe(false);
    }
    expect(Workspace.validName('my_module.py')).toBe(true);
  });

  it('will not delete, rename or move the project folder itself', async () => {
    await expect(ws.remove(dir)).rejects.toThrow();
    await expect(ws.rename(dir, 'x')).rejects.toThrow();
    await expect(ws.move(path.join(dir, 'src'), path.join(dir, 'src'))).rejects.toThrow(/into itself/);
  });
});

describe('Workspace: tree and files', () => {
  it('lists folders first, flags heavy folders', async () => {
    const items = await ws.list(dir);
    expect(items.map((i) => i.name)).toEqual(['__pycache__', 'src', 'main.py']);
    expect(items.find((i) => i.name === '__pycache__').heavy).toBe(true);
  });

  it('creates, renames, moves and deletes (to the bin)', async () => {
    const f = await ws.create(dir, 'notes.py', 'file');
    await expect(ws.create(dir, 'notes.py', 'file')).rejects.toThrow(); // exists
    const renamed = await ws.rename(f, 'todo.py');
    expect(path.basename(renamed)).toBe('todo.py');
    const moved = await ws.move(renamed, path.join(dir, 'src'));
    expect(fs.existsSync(moved)).toBe(true);
    await ws.remove(moved);
    expect(trashed).toEqual([moved]);
  });

  it('refuses binary files and reads text', async () => {
    await expect(ws.read(path.join(dir, '__pycache__', 'x.pyc'))).rejects.toThrow(/binary/);
    expect(await ws.read(path.join(dir, 'main.py'))).toContain('print(add(1, 2))');
  });
});

describe('Workspace: search and replace', () => {
  it('finds matches with line and column, skipping heavy folders', async () => {
    const { results, total } = await ws.search('add');
    expect(total).toBe(3);
    const rels = results.map((r) => r.rel.replace(/\\/g, '/'));
    expect(rels).toEqual(['main.py', 'src/helpers.py']);
    expect(results[1].matches[0]).toMatchObject({ line: 1, col: 5, length: 3 });
  });

  it('supports case, whole word and regex', async () => {
    expect((await ws.search('ADD', { matchCase: true })).total).toBe(0);
    expect((await ws.search('a', { wholeWord: true })).total).toBe(2); // the parameter a in helpers.py
    expect((await ws.search('a(dd)?\\(', { regex: true })).total).toBe(2);
    await expect(ws.search('(', { regex: true })).rejects.toThrow(/regular expression/);
  });

  it('replaces literally, or with groups in regex mode, and skips unsaved files', async () => {
    const r1 = await ws.replaceAll('add', 'plus$1', {}, [path.join(dir, 'main.py')]);
    expect(r1.count).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'src', 'helpers.py'), 'utf8')).toContain('def plus$1(a, b)');
    expect(fs.readFileSync(path.join(dir, 'main.py'), 'utf8')).toContain('import add'); // skipped

    const r2 = await ws.replaceAll('print\\((\\w+)', 'show($1', { regex: true });
    expect(r2.changed.length).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'main.py'), 'utf8')).toContain('show(add(1, 2))');
  });
});

describe('Workspace: git status', () => {
  it('parses branch and file states', () => {
    const out = '## main...origin/main [ahead 1]\n M src/a.py\n?? new.py\nA  added.py\nR  old.py -> renamed.py\n D gone.py\n';
    const { branch, files } = Workspace.parseGitStatus(out);
    expect(branch).toBe('main');
    const norm = Object.fromEntries(Object.entries(files).map(([k, v]) => [k.replace(/\\/g, '/'), v]));
    expect(norm).toEqual({ 'src/a.py': 'M', 'new.py': 'U', 'added.py': 'A', 'renamed.py': 'R', 'gone.py': 'D' });
  });

  it('returns null outside a repository or without git', async () => {
    const noGit = new Workspace({ fs, execFile: (_c, _a, _o, cb) => cb(new Error('not a repo')) });
    await noGit.setRoot(dir);
    expect(await noGit.gitStatus()).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { TestRunner } = require('../electron/test-runner.cjs');

// A Python with pytest (the local test environment, when it exists)
const PY = [path.resolve('tmp/nbenv/Scripts/python.exe'), path.resolve('tmp/nbenv/bin/python')].find((p) => fs.existsSync(p));

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-tests-'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'calc.py'), 'def add(a, b):\n    return a + b\n');
  fs.writeFileSync(path.join(root, 'tests', 'test_calc.py'), [
    'import pytest',
    'from calc import add',
    '',
    'def test_add():',
    '    assert add(2, 3) == 5',
    '',
    'def test_add_wrong():',
    '    print("checking")',
    '    assert add(2, 2) == 5',
    '',
    '@pytest.mark.skip(reason="not yet")',
    'def test_later():',
    '    pass',
    '',
    'class TestMore:',
    '    def test_zero(self):',
    '        assert add(0, 0) == 0',
    '',
  ].join('\n'));
  return root;
}

function runner(root) {
  const events = [];
  const r = new TestRunner({ spawn, getPython: () => PY, getEnv: (b) => b, getRoot: () => root, onEvent: (e) => events.push(e) });
  const until = (test) => new Promise((resolve) => {
    const t = setInterval(() => { if (events.some(test)) { clearInterval(t); resolve(); } }, 30);
  });
  return { r, events, until };
}

describe.skipIf(!PY)('running pytest', () => {
  it('finds pytest', async () => {
    const { r } = runner(os.tmpdir());
    expect(await r.check()).toMatchObject({ ok: true });
  }, 60_000);

  it('collects tests with their files and lines', async () => {
    const root = project();
    const { r, events, until } = runner(root);
    const id = r.start({ collect: true });
    await until((e) => e.type === 'exit');
    const items = events.filter((e) => e.type === 'item' && e.runId === id);
    expect(items.map((i) => i.nodeid)).toEqual([
      'tests/test_calc.py::test_add', 'tests/test_calc.py::test_add_wrong', 'tests/test_calc.py::test_later', 'tests/test_calc.py::TestMore::test_zero',
    ]);
    expect(items[0]).toMatchObject({ name: 'test_add', line: 4, file: path.join(root, 'tests', 'test_calc.py') });
    expect(items[3].cls).toBe('TestMore');
    expect(events.some((e) => e.type === 'result')).toBe(false);
  }, 60_000);

  it('runs tests and reports each result with the failure line', async () => {
    const root = project();
    const { r, events, until } = runner(root);
    r.start();
    await until((e) => e.type === 'exit');
    const res = Object.fromEntries(events.filter((e) => e.type === 'result').map((e) => [e.nodeid.split('::').pop(), e]));
    expect(res.test_add.outcome).toBe('passed');
    expect(res.test_zero.outcome).toBe('passed');
    expect(res.test_later.outcome).toBe('skipped');
    expect(res.test_later.message).toContain('not yet');
    expect(res.test_add_wrong.outcome).toBe('failed');
    expect(res.test_add_wrong.line).toBe(9);
    expect(res.test_add_wrong.message).toMatch(/assert 4 == 5/);
    expect(res.test_add_wrong.stdout).toContain('checking');
    expect(events.find((e) => e.type === 'finished').exitstatus).toBe(1);
  }, 60_000);

  it('runs only the chosen tests', async () => {
    const root = project();
    const { r, events, until } = runner(root);
    r.start({ ids: ['tests/test_calc.py::TestMore'] });
    await until((e) => e.type === 'exit');
    expect(events.filter((e) => e.type === 'result').map((e) => e.nodeid)).toEqual(['tests/test_calc.py::TestMore::test_zero']);
  }, 60_000);

  it('reports a file that cannot be imported', async () => {
    const root = project();
    fs.writeFileSync(path.join(root, 'tests', 'test_broken.py'), 'import nosuchmodule\n\ndef test_x():\n    pass\n');
    const { r, events, until } = runner(root);
    r.start({ collect: true });
    await until((e) => e.type === 'exit');
    const err = events.find((e) => e.type === 'collect-error');
    expect(err.nodeid).toBe('tests/test_broken.py');
    expect(err.message).toContain('nosuchmodule');
  }, 60_000);
});

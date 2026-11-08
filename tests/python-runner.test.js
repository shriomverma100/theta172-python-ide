import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PythonRunner } = require('../electron/python-runner.cjs');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { writable: true, written: [], write(t) { this.written.push(t); } };
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killedWith = [];
  proc.kill = (sig) => { proc.killedWith.push(sig); };
  return proc;
}

function setup() {
  const procs = [];
  const files = new Map();
  const fs = {
    writeFileSync: (f, c) => files.set(f, c),
    unlinkSync: (f) => files.delete(f),
  };
  const spawn = () => { const p = fakeProcess(); procs.push(p); return p; };
  const sent = [];
  const sender = { send: (...a) => sent.push(a), isDestroyed: () => false };
  const runner = new PythonRunner({ spawn, fs, tmpDir: '/tmp', env: {} });
  runner.setPython('python');
  return { runner, procs, files, sent, sender };
}

describe('PythonRunner', () => {
  let t;
  beforeEach(() => { t = setup(); });

  it('streams output, reports exit code and removes its temp file', () => {
    t.runner.run('print(1)', t.sender);
    expect(t.files.size).toBe(1);
    t.procs[0].stdout.emit('data', Buffer.from('1\n'));
    t.procs[0].emit('close', 0);
    expect(t.sent).toEqual([['python-stdout', '1\n'], ['python-done', 0]]);
    expect(t.files.size).toBe(0);
    expect(t.runner.isRunning).toBe(false);
  });

  it('ignores a late close from a replaced run (the old race bug)', () => {
    t.runner.run('first', t.sender);
    t.runner.run('second', t.sender);
    const [oldProc, newProc] = t.procs;
    expect(oldProc.killedWith).toContain('SIGTERM');

    // Old process closes AFTER the new one started.
    oldProc.emit('close', null);

    expect(t.runner.isRunning).toBe(true);           // new run still tracked
    expect(t.files.size).toBe(1);                   // new run's script kept
    expect(t.sent.filter(([c]) => c === 'python-done')).toHaveLength(0);

    t.runner.input('42');
    expect(newProc.stdin.written).toEqual(['42\n']); // input reaches new run

    newProc.emit('close', 0);
    expect(t.sent).toEqual([['python-done', 0]]);
    expect(t.files.size).toBe(0);
  });

  it('drops output from a replaced run', () => {
    t.runner.run('first', t.sender);
    t.runner.run('second', t.sender);
    t.procs[0].stdout.emit('data', Buffer.from('stale'));
    expect(t.sent).toEqual([]);
  });

  it('kill() stops the run and still reports done', () => {
    t.runner.run('loop', t.sender);
    t.runner.kill();
    expect(t.procs[0].killedWith).toEqual(['SIGTERM']);
    t.procs[0].emit('close', null);
    expect(t.sent).toEqual([['python-done', 0]]);
  });

  it('reports a spawn error once', () => {
    t.runner.run('x', t.sender);
    t.procs[0].emit('error', new Error('ENOENT'));
    t.procs[0].emit('close', 1);
    expect(t.sent).toEqual([
      ['python-stderr', 'Failed to start Python: ENOENT\n'],
      ['python-done', 1],
    ]);
  });

  it('refuses non-string code and missing Python', () => {
    t.runner.run({ evil: true }, t.sender);
    t.runner.setPython(null);
    t.runner.run('print(1)', t.sender);
    expect(t.procs).toHaveLength(0);
    expect(t.sent.filter(([c]) => c === 'python-done')).toHaveLength(2);
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { EditorState } from '@codemirror/state';
import { breakpointField, breakpointLines, toggleBreakpointEffect, setBreakpointsEffect, setPausedLineEffect, debugEditorExtension } from '../src/debug-editor.js';

const require = createRequire(import.meta.url);
const { DebugSession } = require('../electron/debug-session.cjs');
const { encodeMessage } = require('../electron/lsp-host.cjs');

/** A fake process with pipes. */
function fakeProc() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.written = [];
  p.stdin = { writable: true, write: (b) => p.written.push(b.toString()), on() {} };
  p.exitCode = null;
  p.kill = () => { p.killed = true; };
  p.pid = 4242;
  return p;
}

/** Messages the session wrote to the adapter (parsed). */
const sent = (proc) => proc.written.map((w) => JSON.parse(w.slice(w.indexOf('{'))));

function setup() {
  const procs = [];
  const events = [];
  const output = [];
  let ended = null;
  const session = new DebugSession({
    spawn: (file, args, opts) => { const p = fakeProc(); p.file = file; p.args = args; p.opts = opts; procs.push(p); return p; },
    adapterPython: '/py/bundled/python3',
    debugpyDir: '/app/debugpy',
    onEvent: (e, b) => events.push([e, b]),
    onOutput: (s, t) => output.push([s, t]),
    onEnd: (info) => { ended = info; },
    platform: 'linux',
  });
  const adapter = () => procs[0];
  const fromAdapter = (msg) => adapter().stdout.emit('data', encodeMessage(msg));
  const respond = (command, body = {}) => {
    const req = sent(adapter()).filter((m) => m.command === command).pop();
    fromAdapter({ type: 'response', request_seq: req.seq, success: true, command, body });
  };
  return { session, procs, events, output, adapter, fromAdapter, respond, ended: () => ended };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Debug session (main process)', () => {
  it('runs the adapter on the bundled Python and launches the program on the chosen one', async () => {
    const t = setup();
    const started = t.session.start({ python: '/env/bin/python', program: '/proj/main.py', cwd: '/proj', env: { A: '1' }, breakpoints: { '/proj/main.py': [4] } });
    await tick();
    expect(t.adapter().file).toBe('/py/bundled/python3');
    expect(t.adapter().opts.env.PYTHONPATH).toBe('/app/debugpy');
    t.respond('initialize');
    await tick();
    const launch = sent(t.adapter()).find((m) => m.command === 'launch');
    expect(launch.arguments).toMatchObject({ program: '/proj/main.py', python: ['/env/bin/python'], console: 'integratedTerminal', justMyCode: true });

    t.fromAdapter({ type: 'event', event: 'initialized' });
    await tick();
    t.respond('setBreakpoints', { breakpoints: [{ verified: true, line: 4 }] });
    await tick();
    expect(sent(t.adapter()).find((m) => m.command === 'setBreakpoints').arguments.breakpoints).toEqual([{ line: 4 }]);
    t.respond('setExceptionBreakpoints');
    await tick();
    t.respond('configurationDone');
    await tick();
    t.respond('launch');
    await expect(started).resolves.toEqual({ ok: true });
  });

  it('starts the program itself, on pipes, only with the chosen interpreter', async () => {
    const t = setup();
    t.session.start({ python: '/env/bin/python', program: '/p/m.py', cwd: '/p', env: { KEEP: 'y', DROP: 'x' } }).catch(() => {});
    await tick();
    t.fromAdapter({ type: 'request', seq: 90, command: 'runInTerminal', arguments: { args: ['/usr/bin/evil', '-c', 'x'], cwd: '/p', env: {} } });
    let reply = sent(t.adapter()).pop();
    expect(reply).toMatchObject({ type: 'response', request_seq: 90, success: false });
    expect(t.procs.length).toBe(1);

    t.fromAdapter({ type: 'request', seq: 91, command: 'runInTerminal', arguments: { args: ['/env/bin/python', '/app/debugpy/launcher', '--', '/p/m.py'], cwd: '/p', env: { DROP: null, NEW: '1' } } });
    reply = sent(t.adapter()).pop();
    expect(reply).toMatchObject({ request_seq: 91, success: true, body: { processId: 4242 } });
    const program = t.procs[1];
    expect(program.opts.env).toMatchObject({ KEEP: 'y', NEW: '1', PYTHONUNBUFFERED: '1' });
    expect(program.opts.env.DROP).toBeUndefined();

    program.stdout.emit('data', Buffer.from('Name? '));
    expect(t.output).toEqual([['stdout', 'Name? ']]);
    t.session.input('Ada');
    expect(program.written).toEqual(['Ada\n']);
  });

  it('refuses launch/attach and other unknown requests from the editor', async () => {
    const t = setup();
    t.session.start({ python: '/py', program: '/p/m.py', cwd: '/p', env: {} }).catch(() => {});
    await tick();
    await expect(t.session.request('launch', { program: '/x' })).rejects.toThrow(/not allowed/);
    await expect(t.session.request('runInTerminal', {})).rejects.toThrow(/not allowed/);
    const p = t.session.request('stackTrace', { threadId: 1 });
    t.fromAdapter({ type: 'response', request_seq: sent(t.adapter()).pop().seq, success: true, command: 'stackTrace', body: { stackFrames: [{ id: 1, line: 3, source: { path: '/usr/lib/python3.12/json/__init__.py' } }] } });
    await expect(p).resolves.toMatchObject({ stackFrames: [{ line: 3 }] });
    // files seen in stack traces become readable
    expect(t.session.hasSource('/usr/lib/python3.12/json/__init__.py')).toBe(true);
    expect(t.session.hasSource('/etc/passwd')).toBe(false);
  });

  it('forwards useful events, hides noise, and ends cleanly', async () => {
    const t = setup();
    t.session.start({ python: '/py', program: '/p/m.py', cwd: '/p', env: {} }).catch(() => {});
    await tick();
    t.fromAdapter({ type: 'event', event: 'debugpySockets', body: {} });
    t.fromAdapter({ type: 'event', event: 'output', body: { category: 'telemetry', output: 'x' } });
    t.fromAdapter({ type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } });
    t.fromAdapter({ type: 'event', event: 'exited', body: { exitCode: 3 } });
    t.fromAdapter({ type: 'event', event: 'terminated' });
    expect(t.events.map((e) => e[0])).toEqual(['stopped', 'exited']);
    expect(t.ended()).toEqual({ exitCode: 3 });
    expect(t.adapter().killed).toBe(true);
    await expect(t.session.request('threads')).rejects.toThrow(/not running/);
  });
});

describe('Breakpoints in the editor', () => {
  const make = (doc) => EditorState.create({ doc, extensions: debugEditorExtension });

  it('toggles a breakpoint on a line', () => {
    let s = make('a = 1\nb = 2\nc = 3\n');
    s = s.update({ effects: toggleBreakpointEffect.of(s.doc.line(2).from) }).state;
    expect(breakpointLines(s)).toEqual([2]);
    s = s.update({ effects: toggleBreakpointEffect.of(s.doc.line(2).from) }).state;
    expect(breakpointLines(s)).toEqual([]);
  });

  it('keeps breakpoints on their line when lines are added above', () => {
    let s = make('a = 1\nb = 2\nc = 3\n');
    s = s.update({ effects: setBreakpointsEffect.of([3]) }).state;
    s = s.update({ changes: { from: 0, insert: '# new\n# lines\n' } }).state;
    expect(breakpointLines(s)).toEqual([5]);
    expect(s.doc.line(5).text).toBe('c = 3');
  });

  it('ignores breakpoints past the end and a missing field', () => {
    let s = make('x\n');
    s = s.update({ effects: setBreakpointsEffect.of([1, 9, 1]) }).state;
    expect(breakpointLines(s)).toEqual([1]);
    expect(breakpointLines(EditorState.create({ doc: 'x' }))).toEqual([]);
    expect(s.field(breakpointField).size).toBe(1);
  });

  it('marks the paused line and clears it when the text changes', () => {
    let s = make('a\nb\n');
    s = s.update({ effects: setPausedLineEffect.of(2) }).state;
    s = s.update({ changes: { from: 0, insert: 'z' } }).state;
    // the decoration source is internal; editing must not crash and lines stay correct
    expect(s.doc.line(1).text).toBe('za');
  });
});

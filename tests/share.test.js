import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { PackageCache, mirrorArgs } = require('../electron/package-mesh.cjs');
const { GpuPool } = require('../electron/gpu-pool.cjs');

const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

const cleanup = [];
afterEach(() => { for (const fn of cleanup.splice(0)) { try { fn(); } catch (_) { /* done */ } } });

describe('class package folder', () => {
  it('serves wheels with their hashes, and nothing else', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-pkg-'));
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const wheel = Buffer.from('fake wheel bytes');
    fs.writeFileSync(path.join(dir, 'tinylib-1.0-py3-none-any.whl'), wheel);
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'not shared');
    const cache = new PackageCache({ dir, spawn: () => null, getPython: () => null });
    cleanup.push(() => cache.stop());
    const port = await cache.serve();
    const sha = crypto.createHash('sha256').update(wheel).digest('hex');

    const index = await get(`http://127.0.0.1:${port}/simple/`);
    expect(index.status).toBe(200);
    expect(index.body.toString()).toContain(`/files/tinylib-1.0-py3-none-any.whl#sha256=${sha}`);
    expect(index.body.toString()).not.toContain('secret');
    const file = await get(`http://127.0.0.1:${port}/files/tinylib-1.0-py3-none-any.whl`);
    expect(file.body.equals(wheel)).toBe(true);
    expect((await get(`http://127.0.0.1:${port}/files/secret.txt`)).status).toBe(404);
    expect((await get(`http://127.0.0.1:${port}/files/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect(cache.summary()).toMatchObject({ files: 1, packages: ['tinylib'], port });
    expect(mirrorArgs('http://x/simple/')).toEqual(['--no-index', '--find-links', 'http://x/simple/']);
  });

  it('refuses package names that are not names', async () => {
    const cache = new PackageCache({ dir: os.tmpdir(), spawn: () => null, getPython: () => 'python' });
    await expect(cache.prepare(['--index-url=http://evil'], () => {})).rejects.toThrow(/package names/);
  });
});

describe('class GPU pool', () => {
  function fakeProc() {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => p.emit('close', null);
    return p;
  }
  function pool() {
    const sent = [];
    const procs = [];
    const states = [];
    const gp = new GpuPool({
      spawn: (cmd, args, opts) => { const p = fakeProc(); p.args = args; p.opts = opts; procs.push(p); return p; },
      execFile: (cmd, args, opts, cb) => cb(null, 'NVIDIA RTX 3060, 12288 MiB\n'),
      getPython: () => 'python',
      getEnv: (b) => b,
      sendTo: (id, msg) => sent.push([id, msg]),
      onState: (s) => states.push(s),
    });
    cleanup.push(() => gp.dispose());
    return { gp, sent, procs, states };
  }
  const student = { id: 'student-1', name: 'Asha' };

  it('needs the teacher to share, then to accept; output streams back', async () => {
    const { gp, sent, procs } = pool();
    gp.submit(student, { type: 'gpu-job', jobId: 'job1abc', fileName: 'train.py', code: 'print(1)' });
    expect(sent.at(-1)[1]).toMatchObject({ type: 'gpu-status', state: 'declined' });

    const caps = await gp.setSharing(true);
    expect(caps).toMatchObject({ name: 'NVIDIA RTX 3060', gpu: true });
    gp.submit(student, { type: 'gpu-job', jobId: 'job2abc', fileName: 'train.py', code: 'print(1)' });
    expect(sent.at(-1)[1]).toMatchObject({ state: 'queued', position: 1 });
    expect(procs).toHaveLength(0); // not before the teacher accepts
    // Only one job per student at a time
    gp.submit(student, { type: 'gpu-job', jobId: 'job3abc', fileName: 'x.py', code: 'print(2)' });
    expect(sent.at(-1)[1]).toMatchObject({ state: 'declined', jobId: 'job3abc' });

    gp.accept(gp.state().jobs[0].id);
    expect(procs).toHaveLength(1);
    expect(procs[0].args[0]).toBe('-u');
    expect(fs.readFileSync(procs[0].args[1], 'utf8')).toBe('print(1)');
    procs[0].stdout.emit('data', Buffer.from('epoch 1 loss 0.5\n'));
    await new Promise((r) => setTimeout(r, 200));
    expect(sent.some(([id, m]) => id === 'student-1' && m.type === 'gpu-output' && m.text.includes('epoch 1'))).toBe(true);
    procs[0].emit('close', 0);
    expect(sent.at(-1)[1]).toMatchObject({ type: 'gpu-status', state: 'done', exitCode: 0 });
    expect(fs.existsSync(path.dirname(procs[0].args[1]))).toBe(false); // the job folder is removed
  });

  it('accepts automatically when asked, one job at a time, and stops on request', async () => {
    const { gp, sent, procs } = pool();
    await gp.setSharing(true, { autoAccept: true });
    gp.submit(student, { type: 'gpu-job', jobId: 'jobAaaa', code: 'while True: pass' });
    gp.submit({ id: 'student-2', name: 'Ravi' }, { type: 'gpu-job', jobId: 'jobBbbb', code: 'print(2)' });
    expect(procs).toHaveLength(1);
    gp.cancelFromStudent('student-1', 'jobAaaa');
    expect(sent.find(([id, m]) => id === 'student-1' && m.state === 'failed')[1].message).toBe('Stopped.');
    expect(procs).toHaveLength(2); // Ravi's job started next
    gp.stop(gp.state().jobs.find((j) => j.state === 'running').id);
    expect(sent.at(-1)[1].message).toBe('Stopped by your teacher.');
  });

  it('turning sharing off declines waiting jobs', async () => {
    const { gp, sent } = pool();
    await gp.setSharing(true);
    gp.submit(student, { type: 'gpu-job', jobId: 'jobCccc', code: 'print(1)' });
    await gp.setSharing(false);
    expect(sent.at(-1)[1]).toMatchObject({ state: 'declined' });
    expect(gp.caps()).toBe(null);
  });
});

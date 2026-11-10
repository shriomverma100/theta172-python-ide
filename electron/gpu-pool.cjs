/**
 * THETA172 — Class GPU pool (teacher / lab machine side).
 *
 * Students without a GPU send a training script to the computer that shares
 * its GPU (the teacher's, or a lab machine running a class). The teacher
 * approves each job (or turns on automatic approval); jobs run one at a
 * time in a fresh folder, on the Python the teacher chose (the one with
 * torch / tensorflow), with a time limit, and the output streams back to
 * the student who sent it.
 *
 * Off by default: a job runs with this computer's permissions.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MAX_QUEUE = 30;
const MAX_CODE = 300_000;
const DEFAULT_LIMIT_MIN = 20;
const FLUSH_MS = 120;

class GpuPool {
  /**
   * @param {object} deps
   * @param {Function} deps.spawn
   * @param {Function} deps.execFile
   * @param {() => string|null} deps.getPython
   * @param {(base: object) => object} deps.getEnv
   * @param {(studentId: string, msg: object) => void} deps.sendTo   to one student
   * @param {(state: object) => void} deps.onState                    to the teacher's window
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.sharing = false;
    this.autoAccept = false;
    this.limitMin = DEFAULT_LIMIT_MIN;
    this.gpu = null; // { name, memory } | null
    this.jobs = []; // { id, studentId, name, fileName, code, state, at, startedAt, endedAt, exitCode }
    this.proc = null;
  }

  /** Which GPU this computer has (NVIDIA through nvidia-smi); null when none is found. */
  detect() {
    return new Promise((resolve) => {
      this.execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
        if (err || !stdout.trim()) { resolve(null); return; }
        const [name, memory] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
        resolve({ name: name || 'GPU', memory: memory || '' });
      });
    });
  }

  async setSharing(on, { autoAccept, limitMin } = {}) {
    this.sharing = !!on;
    if (autoAccept !== undefined) this.autoAccept = !!autoAccept;
    if (Number.isInteger(limitMin) && limitMin >= 1 && limitMin <= 240) this.limitMin = limitMin;
    if (this.sharing && this.gpu === null) this.gpu = (await this.detect()) || false;
    if (!this.sharing) {
      for (const j of this.jobs) if (j.state === 'queued') this._finish(j, 'declined', 'The GPU is no longer shared.');
    }
    this._emit();
    return this.caps();
  }

  /** What students are told: null when not sharing. */
  caps() {
    if (!this.sharing) return null;
    return { name: this.gpu ? this.gpu.name : 'CPU only (no NVIDIA GPU found)', memory: this.gpu ? this.gpu.memory : '', gpu: !!this.gpu, limitMin: this.limitMin };
  }

  /** A student sent a job. */
  submit(student, msg) {
    const reply = (m) => this.sendTo(student.id, m);
    const jobId = typeof msg.jobId === 'string' && /^[\w-]{4,40}$/.test(msg.jobId) ? msg.jobId : null;
    if (!jobId) return;
    if (!this.sharing) { reply({ type: 'gpu-status', jobId, state: 'declined', message: 'The class GPU is not shared right now.' }); return; }
    if (typeof msg.code !== 'string' || !msg.code.trim() || msg.code.length > MAX_CODE) {
      reply({ type: 'gpu-status', jobId, state: 'declined', message: 'The script is empty or too large.' });
      return;
    }
    if (this.jobs.filter((j) => j.state === 'queued').length >= MAX_QUEUE) {
      reply({ type: 'gpu-status', jobId, state: 'declined', message: 'The queue is full. Try again later.' });
      return;
    }
    if (this.jobs.some((j) => j.studentId === student.id && (j.state === 'queued' || j.state === 'running'))) {
      reply({ type: 'gpu-status', jobId, state: 'declined', message: 'You already have a job waiting or running.' });
      return;
    }
    const job = {
      id: `${student.id}:${jobId}`, jobId, studentId: student.id, name: student.name,
      fileName: String(msg.fileName || 'train.py').replace(/[^\w.-]/g, '_').slice(0, 80) || 'train.py',
      code: msg.code, state: 'queued', at: Date.now(),
    };
    this.jobs.push(job);
    if (this.jobs.length > 60) this.jobs.splice(0, this.jobs.length - 60);
    reply({ type: 'gpu-status', jobId, state: 'queued', position: this._position(job), message: this.autoAccept ? '' : 'Waiting for your teacher to accept it.' });
    if (this.autoAccept) job.accepted = true;
    this._emit();
    this._next();
  }

  accept(id) {
    const job = this.jobs.find((j) => j.id === id && j.state === 'queued');
    if (!job) return;
    job.accepted = true;
    this.sendTo(job.studentId, { type: 'gpu-status', jobId: job.jobId, state: 'queued', position: this._position(job), message: 'Accepted: it runs as soon as the GPU is free.' });
    this._emit();
    this._next();
  }

  decline(id) {
    const job = this.jobs.find((j) => j.id === id && j.state === 'queued');
    if (job) this._finish(job, 'declined', 'Your teacher declined this job.');
  }

  stop(id) {
    const job = this.jobs.find((j) => j.id === id && j.state === 'running');
    if (job && this.proc) { job.stoppedBy = 'teacher'; try { this.proc.kill(); } catch (_) { /* gone */ } }
  }

  /** The student cancelled their own job. */
  cancelFromStudent(studentId, jobId) {
    const job = this.jobs.find((j) => j.studentId === studentId && j.jobId === jobId && (j.state === 'queued' || j.state === 'running'));
    if (!job) return;
    if (job.state === 'queued') this._finish(job, 'cancelled', 'Cancelled.');
    else { job.stoppedBy = 'student'; try { this.proc?.kill(); } catch (_) { /* gone */ } }
  }

  /** A student left: their waiting jobs go away. */
  studentLeft(studentId) {
    for (const j of this.jobs) if (j.studentId === studentId && j.state === 'queued') { j.state = 'cancelled'; j.endedAt = Date.now(); }
    this._emit();
  }

  dispose() {
    this.sharing = false;
    try { this.proc?.kill(); } catch (_) { /* gone */ }
    this.proc = null;
    this.jobs = [];
  }

  state() {
    return {
      sharing: this.sharing, autoAccept: this.autoAccept, limitMin: this.limitMin, gpu: this.gpu || null,
      jobs: this.jobs.slice(-20).map(({ code, ...j }) => ({ ...j, lines: code.split('\n').length })),
    };
  }

  _position(job) { return this.jobs.filter((j) => j.state === 'queued' && j.at <= job.at).length; }

  _emit() { this.onState?.(this.state()); }

  _finish(job, state, message, extra = {}) {
    job.state = state;
    job.endedAt = Date.now();
    this.sendTo(job.studentId, { type: 'gpu-status', jobId: job.jobId, state, message, ...extra });
    this._emit();
  }

  _next() {
    if (this.proc) return;
    const job = this.jobs.find((j) => j.state === 'queued' && j.accepted);
    if (!job) return;
    const python = this.getPython();
    if (!python) { this._finish(job, 'failed', 'No Python is selected on the GPU computer.'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-gpu-job-'));
    const file = path.join(dir, job.fileName.endsWith('.py') ? job.fileName : `${job.fileName}.py`);
    fs.writeFileSync(file, job.code, 'utf8');
    job.state = 'running';
    job.startedAt = Date.now();
    this.sendTo(job.studentId, { type: 'gpu-status', jobId: job.jobId, state: 'running', message: `Running on ${this.caps()?.name || 'the class GPU'}` });
    this._emit();

    const proc = this.spawn(python, ['-u', file], {
      cwd: dir, windowsHide: true,
      env: { ...this.getEnv(process.env), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' },
    });
    this.proc = proc;
    // Output goes back in small batches
    let buf = { stdout: '', stderr: '' };
    const flush = () => {
      for (const stream of ['stdout', 'stderr']) {
        if (buf[stream]) this.sendTo(job.studentId, { type: 'gpu-output', jobId: job.jobId, stream, text: buf[stream].slice(-50_000) });
      }
      buf = { stdout: '', stderr: '' };
    };
    const timer = setInterval(flush, FLUSH_MS);
    const limit = setTimeout(() => { job.stoppedBy = 'time'; try { proc.kill(); } catch (_) { /* gone */ } }, this.limitMin * 60_000);
    proc.stdout?.on('data', (b) => { buf.stdout += b.toString(); });
    proc.stderr?.on('data', (b) => { buf.stderr += b.toString(); });
    const done = (code) => {
      if (this.proc !== proc) return;
      clearInterval(timer);
      clearTimeout(limit);
      flush();
      this.proc = null;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* still in use */ }
      const seconds = Math.round((Date.now() - job.startedAt) / 1000);
      job.exitCode = code;
      const why = { teacher: 'Stopped by your teacher.', student: 'Stopped.', time: `Stopped: the time limit is ${this.limitMin} minutes.` }[job.stoppedBy];
      this._finish(job, code === 0 ? 'done' : 'failed', why || (code === 0 ? `Finished in ${seconds} s` : `Exited with code ${code}`), { seconds, exitCode: code });
      this._next();
    };
    proc.on('close', done);
    proc.on('error', (err) => { buf.stderr += `${err.message}\n`; done(1); });
  }
}

const newJobId = () => crypto.randomBytes(6).toString('hex');

module.exports = { GpuPool, newJobId };

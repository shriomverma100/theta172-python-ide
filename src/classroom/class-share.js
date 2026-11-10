/**
 * What a class shares (Phase 10c):
 *  - class packages: the teacher downloads packages once; students on the
 *    same network install from the teacher's laptop (works without internet);
 *  - the class GPU: students send a training script to the computer that
 *    shares its GPU; the teacher accepts it and the output streams back.
 */
import { state } from '../app/state.js';
import { switchPane } from '../app/layout.js';
import { showToast } from '../toast.js';

const api = () => window.electronAPI;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (cls, text, onClick, title) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;

// ══════════════════════════════════════════════════════════════════
// TEACHER
// ══════════════════════════════════════════════════════════════════

let teacherOn = false;
let gpu = { sharing: false, autoAccept: false, jobs: [], gpu: null, limitMin: 20 };
let packages = null; // summary

export function initClassShare() {
  api()?.onGpuState?.((s) => { gpu = s; renderShare(); });
  api()?.onClassPackagesLog?.((t) => {
    const log = document.getElementById('cr-pkg-log');
    if (log) { log.textContent += t; log.scrollTop = log.scrollHeight; }
  });
}

export async function shareStarted() {
  teacherOn = true;
  packages = await api()?.classPackagesSummary?.();
  gpu = (await api()?.gpuState?.()) || gpu;
  renderShare();
}

export function shareStopped() {
  teacherOn = false;
  gpu = { sharing: false, autoAccept: false, jobs: [], gpu: null, limitMin: 20 };
  document.getElementById('cr-share')?.replaceChildren();
}

function renderShare() {
  const box = document.getElementById('cr-share');
  if (!box) return;
  box.replaceChildren();
  if (!teacherOn) return;

  // Packages
  const pkg = el('div', 'cr-share__item');
  pkg.append(el('span', 'cr-share__label', 'Class packages'));
  const n = packages?.packages?.length || 0;
  pkg.append(el('span', 'cr-share__value', n
    ? `${n} package${n === 1 ? '' : 's'} · ${mb(packages.bytes)} · students here install from your laptop`
    : 'none yet: download pandas, numpy… once for the whole class'));
  pkg.append(btn('cr-view-btn', 'Manage', openPackages, 'Download packages once and share them with students on this network'));
  box.append(pkg);

  // GPU
  const g = el('div', 'cr-share__item');
  g.append(el('span', 'cr-share__label', 'Class GPU'));
  if (gpu.sharing) {
    const name = gpu.gpu ? `${gpu.gpu.name}${gpu.gpu.memory ? ` (${gpu.gpu.memory})` : ''}` : 'no NVIDIA GPU found: jobs run on this CPU';
    const waiting = gpu.jobs.filter((j) => j.state === 'queued').length;
    g.append(el('span', 'cr-share__value', `Shared · ${name}${waiting ? ` · ${waiting} waiting` : ''}`));
    const auto = el('label', 'cr-share__check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = gpu.autoAccept;
    cb.addEventListener('change', () => api()?.gpuShare?.(true, { autoAccept: cb.checked }));
    auto.append(cb, document.createTextNode(' accept jobs automatically'));
    g.append(auto, btn('cr-view-btn', 'Stop sharing', () => api()?.gpuShare?.(false)));
  } else {
    g.append(el('span', 'cr-share__value', 'Off: students can send training scripts to this computer when it is on'));
    g.append(btn('cr-action-btn cr-action-btn--sm', 'Share GPU', async () => {
      if (!window.confirm('Share this computer with the class?\n\nStudents can send Python scripts that run here, one at a time, with this computer\'s permissions. You accept each one (unless you turn on automatic acceptance). Only share with a class you trust.')) return;
      const res = await api()?.gpuShare?.(true, {});
      if (res?.state) gpu = res.state;
      renderShare();
    }));
  }
  box.append(g);

  // The GPU queue
  if (gpu.sharing && gpu.jobs.length) {
    const q = el('div', 'cr-share__queue');
    for (const j of [...gpu.jobs].reverse().slice(0, 8)) {
      const row = el('div', `cr-job is-${j.state}`);
      row.append(
        el('b', '', j.name),
        el('span', 'cr-job__file', `${j.fileName} · ${j.lines} lines`),
        el('span', 'cr-job__state', { queued: j.accepted ? 'accepted, waiting' : 'waiting for you', running: 'running', done: 'finished', failed: 'failed', declined: 'declined', cancelled: 'cancelled' }[j.state] || j.state),
      );
      if (j.state === 'queued' && !j.accepted) {
        row.append(btn('cr-action-btn cr-action-btn--sm', 'Accept', () => api()?.gpuAccept?.(j.id)), btn('cr-view-btn', 'Decline', () => api()?.gpuDecline?.(j.id)));
      } else if (j.state === 'running') {
        row.append(btn('cr-view-btn', 'Stop', () => api()?.gpuStop?.(j.id)));
      }
      q.append(row);
    }
    box.append(q);
  }
}

function openPackages() {
  document.getElementById('cr-pkg-modal')?.remove();
  const overlay = el('div', 'viva-modal');
  overlay.id = 'cr-pkg-modal';
  const box = el('div', 'viva-modal__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Class packages');
  const head = el('div', 'viva-modal__head');
  head.append(el('h2', 'viva-modal__title', 'Class packages'), btn('viva-modal__close', '×', () => overlay.remove()));
  const lead = el('p', 'viva-modal__lead', 'Download packages once on this laptop. Students on the same network then install them from you: faster, and it works with no internet in the lab. Anything missing still comes from the internet.');
  const summary = el('p', 'viva-modal__lead cr-pkg-summary');
  const showSummary = () => {
    const names = packages?.packages || [];
    summary.textContent = names.length ? `Ready to share (${mb(packages.bytes)}): ${names.join(', ')}` : 'Nothing downloaded yet.';
  };
  showSummary();
  const row = el('div', 'cr-pkg-row');
  const input = el('input', 'cr-input');
  input.placeholder = 'pandas numpy matplotlib scikit-learn';
  input.spellcheck = false;
  const go = btn('viva-modal__btn viva-modal__btn--primary', 'Download for the class', async () => {
    const specs = input.value.split(/[\s,]+/).filter(Boolean);
    if (!specs.length) { input.focus(); return; }
    go.disabled = true;
    go.textContent = 'Downloading…';
    log.textContent = '';
    try {
      const res = await api().classPackagesPrepare(specs);
      packages = res.summary;
      showToast(res.code === 0 ? 'Packages ready for the class' : 'Some packages could not be downloaded: see the log', res.code === 0 ? 'success' : 'error', 3000);
    } catch (err) {
      log.textContent += `${String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}\n`;
    }
    go.disabled = false;
    go.textContent = 'Download for the class';
    showSummary();
    renderShare();
  });
  row.append(input, go);
  const log = el('pre', 'cr-pkg-log');
  log.id = 'cr-pkg-log';
  const foot = el('div', 'viva-modal__row');
  foot.append(btn('viva-modal__btn', 'Remove all', async () => {
    if (!window.confirm('Remove every downloaded package from the class folder?')) return;
    packages = await api().classPackagesClear();
    showSummary();
    renderShare();
  }), btn('viva-modal__btn', 'Close', () => overlay.remove()));
  box.append(head, lead, summary, row, log, foot);
  overlay.append(box);
  overlay.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') overlay.remove(); });
  document.body.append(overlay);
  input.focus();
}

// ══════════════════════════════════════════════════════════════════
// STUDENT
// ══════════════════════════════════════════════════════════════════

let caps = { packages: null, gpu: null, mirror: false };
let job = null; // { jobId, fileName }

export const classGpu = () => caps.gpu;

/** Class events about sharing; returns true when handled. */
export function handleShareEvent(msg) {
  switch (msg.type) {
    case 'class-caps': {
      const hadGpu = !!caps.gpu;
      caps = { packages: msg.packages || null, gpu: msg.gpu || null, mirror: !!msg.mirror };
      updateStudentShare();
      if (caps.gpu && !hadGpu) showToast(`Your teacher shares a GPU: Run → Run on Class GPU`, 'info', 3500);
      return true;
    }
    case 'gpu-status': {
      if (!job || msg.jobId !== job.jobId) return true;
      const t = state.terminal;
      const text = String(msg.message || '');
      if (msg.state === 'queued') t?.writeSystem(`[class GPU] Waiting${msg.position ? ` (number ${msg.position} in the queue)` : ''}${text ? `: ${text}` : ''}\n`);
      else if (msg.state === 'running') t?.writeSystem(`[class GPU] ${text || 'Running'}\n`);
      else {
        t?.writeSystem(`[class GPU] ${text || msg.state}\n`);
        job = null;
        updateStudentShare();
        if (msg.state === 'done') showToast('Your class GPU job finished', 'success', 2500);
        else if (msg.state === 'failed') showToast('Your class GPU job stopped with an error', 'error', 2500);
      }
      return true;
    }
    case 'gpu-output': {
      if (!job || msg.jobId !== job.jobId) return true;
      const text = String(msg.text || '');
      if (msg.stream === 'stderr') state.terminal?.writeError(text);
      else state.terminal?.writeOutput(text);
      return true;
    }
    default:
      return false;
  }
}

export function shareLeft() {
  caps = { packages: null, gpu: null, mirror: false };
  job = null;
  updateStudentShare();
}

function updateStudentShare() {
  const line = document.getElementById('cr-share-status');
  if (line) {
    const parts = [];
    if (caps.mirror) parts.push('packages from your teacher');
    if (caps.gpu) parts.push(`class GPU: ${caps.gpu.name}`);
    line.textContent = parts.length ? `Shared: ${parts.join(' · ')}` : '';
  }
  document.querySelectorAll('[data-gpu-btn]').forEach((b) => {
    b.classList.toggle('hidden', !caps.gpu);
    b.textContent = job ? 'Stop GPU job' : 'Run on class GPU';
  });
}

/** Send the open file to the class GPU (or stop the job that is running). */
export function runOnClassGpu({ code, fileName }) {
  if (!caps.gpu) { showToast('Your teacher is not sharing a GPU right now', 'info', 2400); return; }
  if (job) {
    api()?.classroomStudentSendEvent?.({ type: 'gpu-cancel', jobId: job.jobId });
    return;
  }
  if (!code.trim()) { showToast('Write the training script first', 'info', 2000); return; }
  job = { jobId: Math.random().toString(36).slice(2, 12), fileName };
  if (state.activePane !== 'terminal') switchPane('terminal');
  state.terminal?.writeRunSeparator();
  state.terminal?.writeSystem(`[class GPU] Sending ${fileName} to ${caps.gpu.name}…\n`);
  api()?.classroomStudentSendEvent?.({ type: 'gpu-job', jobId: job.jobId, fileName, code: code.slice(0, 300_000) });
  updateStudentShare();
}

/**
 * Start-up screen: the THETA172 mark is sketched in pen, inked in red, and
 * the wordmark writes itself; below, one quiet line says what is happening
 * and a thin line shows how far start-up has got. When Python is ready the
 * screen fades into the IDE.
 */
import { $ } from '../core/dom.js';

const STEPS = ['Loading the editor', 'Setting up the terminal', 'Looking for Python on this computer', 'Starting the Python runtime', 'Ready'];
const STEP_COUNT = STEPS.length;
let finished = false;

export function startBoot() {
  document.querySelector('.loading-content')?.classList.add('is-drawing');
  setBootStep(0);
}

/** Mark steps before `index` done and `index` active. */
export function setBootStep(index, detail) {
  for (let i = 0; i < STEP_COUNT; i++) {
    const $step = $(`lstep-${i}`);
    if (!$step) continue;
    $step.classList.toggle('done', i < index);
    $step.classList.toggle('active', i === index);
  }
  const $status = $('boot-status');
  if ($status) $status.textContent = STEPS[Math.min(index, STEP_COUNT - 1)];
  const $bar = $('boot-progress');
  if ($bar) $bar.style.transform = `scaleX(${Math.min(1, (index + 0.5) / STEP_COUNT).toFixed(3)})`;
  if (detail !== undefined) setBootDetail(detail);
}

export function setBootDetail(text) {
  const $detail = $('boot-detail');
  if ($detail) $detail.textContent = text || '';
}

/** Python is ready: complete the line and fade into the IDE. */
export function finishBoot(delayMs = 300) {
  if (finished) return;
  finished = true;
  setBootStep(STEP_COUNT);
  $(`lstep-${STEP_COUNT - 1}`)?.classList.add('done');
  const $bar = $('boot-progress');
  if ($bar) $bar.style.transform = 'scaleX(1)';
  setTimeout(() => {
    const $overlay = $('loading-overlay');
    $overlay?.classList.add('fade-out');
    setTimeout(() => $overlay?.classList.add('hidden'), 420);
  }, delayMs);
}

/** Start-up failed: get out of the way so the error in the terminal is visible. */
export function failBoot() {
  finished = true;
  $('loading-overlay')?.classList.add('hidden');
}

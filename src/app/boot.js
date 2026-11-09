/**
 * Start-up screen: a checklist of real start-up steps, a one-line status
 * detail, and (when pixel effects are on) a spinning core that dissolves
 * into the IDE when Python is ready.
 */
import { $ } from '../core/dom.js';
import { fx, startLoadingLoop, revealApp } from '../fx/moments.js';

const STEP_COUNT = 5;
let loop = null;
let finished = false;

export function startBoot() {
  const $content = document.querySelector('.loading-content');
  if (fx.enabled) {
    loop = startLoadingLoop($('boot-stage'));
    if (loop) $content?.classList.add('has-fx');
  }
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
  if (detail !== undefined) setBootDetail(detail);
}

export function setBootDetail(text) {
  const $detail = $('boot-detail');
  if ($detail) $detail.textContent = text || '';
}

/** Python is ready: tick the last step and reveal the IDE. */
export function finishBoot(delayMs = 300) {
  if (finished) return;
  finished = true;
  setBootStep(STEP_COUNT); // all done
  $(`lstep-${STEP_COUNT - 1}`)?.classList.add('done');

  setTimeout(() => {
    loop?.stop();
    loop = null;
    const $overlay = $('loading-overlay');
    const hide = () => $overlay?.classList.add('hidden');
    if (fx.enabled) {
      // Hide the start-up screen a frame later, once the blinds are on screen
      revealApp(() => requestAnimationFrame(() => requestAnimationFrame(hide)));
    } else {
      $overlay?.classList.add('fade-out');
      setTimeout(hide, 340);
    }
  }, delayMs);
}

/** Start-up failed: get out of the way so the error in the terminal is visible. */
export function failBoot() {
  finished = true;
  loop?.cancel();
  loop = null;
  $('loading-overlay')?.classList.add('hidden');
}

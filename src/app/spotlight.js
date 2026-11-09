/**
 * Spotlight: the layout makes room for whatever you are about to use.
 *
 * The screen looks as usual. When the pointer heads for the Output tile (or
 * the Files tile), that tile smoothly grows and the others step back; moving
 * back to the code returns everything. Keyboard focus does the same, so it
 * works without a mouse. In stacked layouts (study mode, narrow windows) the
 * output grows upwards instead.
 *
 * It only sets data-spot on .ide-body ('output' | 'files'); the sizes and
 * the animation live in study.css.
 */
import { $ } from '../core/dom.js';
import { state } from './state.js';
import { getPrefs, setPrefs } from './session.js';

const ENTER_DELAY = 140;   // ms the pointer must rest on a tile before it grows
const LEAVE_DELAY = 420;   // ms before it shrinks again (no flicker when passing by)
const APPROACH_PX = 72;    // "heading towards" distance from a tile's edge
const APPROACH_SPEED = 0.35; // px per ms towards the tile

let body = null;
let quietUntil = 0; // no spotlight while the layout settles (window resized or moved)
let timer = null;
let current = null;
const listeners = new Set();

/** On by default in Playground; Pro users opt in (Settings). */
export function spotlightEnabled() {
  const p = getPrefs();
  const theme = document.documentElement.dataset.theme === 'pro' ? 'pro' : 'playground';
  const v = p.spotlight?.[theme];
  return v === undefined ? theme === 'playground' : !!v;
}

export function setSpotlightEnabled(on) {
  const theme = document.documentElement.dataset.theme === 'pro' ? 'pro' : 'playground';
  setPrefs({ spotlight: { ...(getPrefs().spotlight || {}), [theme]: !!on } });
  if (!on) setSpot(null);
}

export function getSpot() { return current; }
export function onSpotChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Something is in the way (a dialog, a drag, a menu): don't move the layout under it. */
function blocked() {
  if (!spotlightEnabled()) return true;
  if (performance.now() < quietUntil) return true;
  if (document.querySelector('.modal:not(.hidden), .cmd-palette:not(.hidden), .theme-picker:not(.hidden), .ctx-menu.visible, #context-menu.visible')) return true;
  if ($('split-gutter')?.classList.contains('dragging')) return true;
  return false;
}

/** Ignore the pointer for a while (the layout is changing under it). */
export function quietSpotlight(ms = 800) {
  quietUntil = Math.max(quietUntil, performance.now() + ms);
  clearTimeout(timer);
}

export function setSpot(spot) {
  if (spot === current) return;
  current = spot;
  if (!body) return;
  if (spot) body.dataset.spot = spot;
  else delete body.dataset.spot;
  listeners.forEach((fn) => fn(spot));
}

function schedule(spot, delay) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (spot && blocked()) return;
    setSpot(spot);
  }, delay);
}

/** Terminals measure their size in characters: refit once the layout settles. */
function refit() {
  state.terminal?.fit?.();
  state.replManager?.fit?.();
  state.shell?.fit?.();
}

export function initSpotlight() {
  body = document.querySelector('.ide-body');
  if (!body) return;
  const zones = [
    [$('sidebar'), 'files'],
    [document.querySelector('.ide-pane--terminal'), 'output'],
    [$('editor-pane'), null],
    [document.querySelector('.class-tile'), null],
  ].filter(([el]) => el);

  for (const [el, spot] of zones) {
    el.addEventListener('pointerenter', (e) => {
      if (e.buttons) return; // selecting text or dragging
      schedule(spot, spot ? ENTER_DELAY : LEAVE_DELAY / 3);
    });
    el.addEventListener('pointerleave', (e) => {
      if (!spot || e.buttons) return;
      schedule(null, LEAVE_DELAY);
    });
  }

  // Heading towards a tile counts too: it starts growing before you arrive
  let last = null;
  let raf = 0;
  document.addEventListener('pointermove', (e) => {
    if (raf || e.buttons) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const now = performance.now();
      const prev = last;
      last = { x: e.clientX, y: e.clientY, t: now };
      if (!prev || current || blocked()) return;
      const dt = Math.max(1, now - prev.t);
      const vx = (e.clientX - prev.x) / dt;
      for (const [el, spot, dir] of [[document.querySelector('.ide-pane--terminal'), 'output', 1], [$('sidebar'), 'files', -1]]) {
        if (!el || el.offsetParent === null) continue;
        const r = el.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom) continue;
        const gap = dir > 0 ? r.left - e.clientX : e.clientX - r.right;
        if (gap > 0 && gap < APPROACH_PX && vx * dir > APPROACH_SPEED) schedule(spot, 0);
      }
    });
  }, { passive: true });

  // Keyboard: focus moving into a tile spotlights it
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest('.ide-pane--terminal')) schedule('output', 0);
    else if (t.closest('#sidebar')) schedule('files', 0);
    else if (t.closest('#editor-pane')) schedule(null, 0);
  });

  body.addEventListener('transitionend', (e) => {
    if (e.target === body && /grid-template/.test(e.propertyName)) refit();
  });
  window.addEventListener('blur', () => schedule(null, LEAVE_DELAY));
  window.addEventListener('resize', () => { quietSpotlight(800); setSpot(null); });
}

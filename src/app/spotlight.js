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
  animateLayout(spot);
  listeners.forEach((fn) => fn(spot));
}

// ── Smooth resizing ──────────────────────────────────────────────
// Animating the grid re-lays out the page every frame. That is cheap for the
// tile frames, but the code editor and the terminal would also re-measure and
// re-render on every frame. So for the length of the animation their content
// keeps one fixed size (the larger of before and after, clipped by its tile),
// and they are measured once at the end. The frames move at full frame rate.

const ANIM_MS = 420;
let pinned = [];
let endTimer = null;

/**
 * Frame-time benchmark (tests only): grow and shrink Output `rounds` times
 * and report the frame intervals seen while the tiles move.
 */
export async function benchSpot(rounds = 6) {
  const gaps = [];
  const firsts = [];
  for (let i = 0; i < rounds; i++) {
    const s0 = performance.now();
    setSpot(i % 2 === 0 ? 'output' : null);
    const setupMs = performance.now() - s0;
    await new Promise((resolve) => {
      const t0 = performance.now();
      let last = t0;
      let n = 0;
      const tick = (t) => {
        if (n++ === 0) firsts.push(t - last + setupMs);
        else gaps.push(t - last);
        last = t;
        if (t - t0 < ANIM_MS) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    await new Promise((r) => setTimeout(r, 200));
  }
  setSpot(null);
  const sorted = [...gaps].sort((a, b) => a - b);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return {
    frames: gaps.length,
    avgFps: Math.round(1000 / avg),
    p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
    worstMs: +sorted[sorted.length - 1].toFixed(1),
    over20ms: gaps.filter((g) => g > 20).length,
    firstFrameMs: +(firsts.reduce((a, b) => a + b, 0) / firsts.length).toFixed(1),
  };
}

function applySpot(spot) {
  if (spot) body.dataset.spot = spot;
  else delete body.dataset.spot;
}

/** The heavy parts whose size is held still while tiles move. */
function heavyParts() {
  return [
    document.querySelector('#editor-pane .editor-panes'),
    document.querySelector('#terminal-pane .terminal-well'),
    document.querySelector('#sidebar > :is(#files-view, #search-view, #git-view, #debug-view):not(.hidden)'),
  ].filter((el) => el && el.offsetParent !== null);
}

function unpin() {
  for (const { el, w, h, flex } of pinned) {
    el.style.width = w;
    el.style.height = h;
    el.style.flex = flex;
  }
  pinned = [];
  body.classList.remove('spot-animating');
}

function animateLayout(spot) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.hasAttribute('data-reduced-motion');
  clearTimeout(endTimer);
  if (reduced || window.__spotNoPin) { // (__spotNoPin: the old way, for the frame-rate benchmark)
    unpin();
    applySpot(spot);
    refit();
    return;
  }
  // Sizes now (mid-animation sizes count) and at the end. The end is measured on
  // the tiles (cheap) while the heavy content is already held at its current size;
  // the content's end size = its size now + how much its tile grows.
  if (pinned.length) unpin(); // a new change while animating: measure from where things are
  const parts = heavyParts();
  const tiles = parts.map((el) => el.closest('.ide-pane, .sidebar') || el.parentElement);
  const before = parts.map((el) => el.getBoundingClientRect());
  const tilesBefore = tiles.map((t) => t.getBoundingClientRect());
  pinned = parts.map((el, i) => {
    const saved = { el, w: el.style.width, h: el.style.height, flex: el.style.flex };
    el.style.width = `${before[i].width}px`;
    el.style.height = `${before[i].height}px`;
    el.style.flex = 'none';
    return saved;
  });
  body.classList.add('spot-animating');
  const was = body.dataset.spot || null;
  body.classList.add('spot-measure');
  applySpot(spot);
  const tilesAfter = tiles.map((t) => t.getBoundingClientRect());
  applySpot(was);
  void body.offsetWidth; // commit the old layout before transitions come back
  body.classList.remove('spot-measure');

  parts.forEach((el, i) => {
    const w = before[i].width + Math.max(0, tilesAfter[i].width - tilesBefore[i].width);
    const h = before[i].height + Math.max(0, tilesAfter[i].height - tilesBefore[i].height);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  });
  applySpot(spot);
  endTimer = setTimeout(() => {
    unpin();
    refit();
  }, ANIM_MS + 40);
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

  window.addEventListener('blur', () => schedule(null, LEAVE_DELAY));
  window.addEventListener('resize', () => { quietSpotlight(800); setSpot(null); });
}

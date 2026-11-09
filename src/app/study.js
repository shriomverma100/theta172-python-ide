/**
 * Study mode: lecture on one side of the screen, code on the other.
 *
 * Five layouts (the window really moves and resizes, except Duo):
 *   1 Duo      code and output only, window stays where it is
 *   2 Half     half the screen
 *   3 Mini     a small window that floats over the lecture
 *   4 Third    a tall strip, one third of the screen
 *   5 Quarter  a slim strip, one quarter of the screen
 *
 * When the user narrows or snaps the window beside something else, a small
 * card offers study mode. Everything else is CSS on <html data-study="…">.
 */
import { $ } from '../core/dom.js';
import { showToast } from '../toast.js';
import { getPrefs, setPrefs } from './session.js';
import { state } from './state.js';
import { setSpot, quietSpotlight } from './spotlight.js';
import { focusEditor, setWordWrap } from '../editor.js';
import { screenTransition } from '../fx/moments.js';

export const STUDY_MODES = [
  { id: 'duo', n: 1, name: 'Duo', hint: 'Only code and output. The window stays where it is.' },
  { id: 'half', n: 2, name: 'Half', hint: 'Half the screen. The lecture gets the other half.' },
  { id: 'mini', n: 3, name: 'Mini', hint: 'A small window that floats over the lecture.' },
  { id: 'third', n: 4, name: 'One third', hint: 'A tall strip. The lecture gets two thirds.' },
  { id: 'quarter', n: 5, name: 'One quarter', hint: 'A slim strip for following along.' },
];

const api = () => window.electronAPI;
let mode = null;
let side = 'right'; // where the APP goes; the lecture is on the other side
let suggestedAt = 0;

export const getStudyMode = () => mode;

// ── Pictures of each layout (a screen with the lecture and the app) ──

/**
 * A small drawing of the screen for a mode. The lecture area has a play
 * button and a progress bar; the app shows its code lines and output.
 */
export function layoutPicture(id, appSide = side) {
  const W = 120;
  const H = 72;
  // Duo keeps the window where it is: drawn filling the frame, code beside output
  const app = { duo: [1, 1], half: [0.5, 1], third: [1 / 3, 1], quarter: [0.25, 1], mini: [0.34, 0.62] }[id];
  const aw = Math.round(W * app[0]);
  const ah = Math.round(H * app[1]);
  const ax = appSide === 'right' ? W - aw : 0;
  const ay = id === 'mini' ? H - ah - 4 : 0;
  const mini = id === 'mini';
  const lx = mini ? 0 : appSide === 'right' ? 0 : aw;
  const lw = mini ? W : W - aw;
  // Inside the app: code on top, output below (side by side for Duo)
  const pad = 4;
  const inner = { x: ax + pad, y: ay + pad, w: aw - pad * 2, h: ah - pad * 2 };
  const codeLines = [];
  let codeBox;
  let outBox;
  if (id === 'duo') {
    codeBox = { x: inner.x, y: inner.y, w: inner.w * 0.56, h: inner.h };
    outBox = { x: inner.x + inner.w * 0.6, y: inner.y, w: inner.w * 0.4, h: inner.h };
  } else {
    codeBox = { x: inner.x, y: inner.y, w: inner.w, h: inner.h * 0.58 };
    outBox = { x: inner.x, y: inner.y + inner.h * 0.63, w: inner.w, h: inner.h * 0.37 };
  }
  for (let i = 0; i < 5; i++) {
    const y = codeBox.y + 5 + i * (codeBox.h - 8) / 5;
    if (y > codeBox.y + codeBox.h - 3) break;
    const indent = [0, 0.12, 0.12, 0.24, 0][i];
    const len = [0.55, 0.7, 0.45, 0.6, 0.35][i];
    codeLines.push(`<rect class="lp-line${i === 2 ? ' lp-line--hot' : ''}" x="${(codeBox.x + 3 + codeBox.w * indent).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(4, (codeBox.w - 6) * len).toFixed(1)}" height="2.2" rx="1.1"/>`);
  }
  const lecture = lw > 0 ? `
    <g class="lp-lecture">
      <rect x="${lx + 3}" y="3" width="${lw - 6}" height="${H - 6}" rx="4"/>
      <circle class="lp-play-bg" cx="${lx + lw / 2}" cy="${H / 2 - 4}" r="8"/>
      <path class="lp-play" d="M${lx + lw / 2 - 2.5} ${H / 2 - 8.5}v9l7-4.5Z"/>
      <rect class="lp-track" x="${lx + 9}" y="${H - 13}" width="${lw - 18}" height="2.4" rx="1.2"/>
      <rect class="lp-progress" x="${lx + 9}" y="${H - 13}" width="${(lw - 18) * 0.4}" height="2.4" rx="1.2"/>
    </g>` : '';
  return `<svg class="lp" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <rect class="lp-screen" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6"/>
    ${lecture}
    <g class="lp-app${mini ? ' lp-app--float' : ''}">
      <rect class="lp-app-bg" x="${ax + 1}" y="${ay + 1}" width="${aw - 2}" height="${ah - 2}" rx="4"/>
      <rect class="lp-code" x="${codeBox.x}" y="${codeBox.y}" width="${codeBox.w.toFixed(1)}" height="${codeBox.h.toFixed(1)}" rx="2.5"/>
      ${codeLines.join('')}
      <rect class="lp-out" x="${outBox.x.toFixed(1)}" y="${outBox.y.toFixed(1)}" width="${outBox.w.toFixed(1)}" height="${outBox.h.toFixed(1)}" rx="2.5"/>
      <rect class="lp-out-line" x="${(outBox.x + 3).toFixed(1)}" y="${(outBox.y + 4).toFixed(1)}" width="${Math.max(4, outBox.w * 0.5).toFixed(1)}" height="2" rx="1"/>
    </g>
  </svg>`;
}

// ── Entering and leaving ─────────────────────────────────────────

/** Narrow strips wrap long lines so code never runs off the edge; leaving restores the setting. */
const WRAPS = new Set(['third', 'quarter', 'mini']);
function applyWrap() {
  setWordWrap(mode && WRAPS.has(mode) ? true : !!getPrefs().wrap);
}

function refitSoon() {
  // The window animates to its new size; terminals measure in characters
  for (const ms of [80, 420, 900]) {
    setTimeout(() => {
      state.terminal?.fit?.();
      state.replManager?.fit?.();
      state.shell?.fit?.();
    }, ms);
  }
}

function renderBar() {
  const $bar = $('study-bar');
  if (!$bar) return;
  $bar.classList.toggle('hidden', !mode);
  const m = STUDY_MODES.find((x) => x.id === mode);
  const $name = $('study-bar-label');
  if ($name && m) $name.textContent = m.name;
  const $flip = $('study-flip');
  if ($flip) {
    $flip.hidden = !mode || mode === 'duo';
    $flip.title = `Move to the ${side === 'right' ? 'left' : 'right'} side`;
  }
}

export async function enterStudy(id, appSide = side) {
  const m = STUDY_MODES.find((x) => x.id === id);
  if (!m) return;
  side = appSide === 'left' ? 'left' : 'right';
  const wasOn = !!mode;
  mode = id;
  setSpot(null);
  quietSpotlight(1500); // the window moves under the pointer: don't react to that
  setPrefs({ study: { mode: id, side } });
  closeStudySheet();
  hideSuggestion();
  // Pixel blinds cover the screen while the window and layout change
  const apply = () => {
    document.documentElement.dataset.study = id;
    delete document.documentElement.dataset.drawer;
    applyWrap();
    renderBar();
    api()?.studyPlace?.(id, side).catch(() => {});
    refitSoon();
  };
  if (wasOn) apply();
  else await screenTransition(apply);
  focusEditor();
}

export async function exitStudy() {
  if (!mode) return;
  mode = null;
  closeStudySheet();
  quietSpotlight(1500);
  await screenTransition(() => {
    delete document.documentElement.dataset.study;
    delete document.documentElement.dataset.drawer;
    applyWrap();
    renderBar();
    api()?.studyExit?.().catch(() => {});
    refitSoon();
  });
  focusEditor();
}

/** In study mode the sidebar (files, search, debug) opens as a drawer. */
export function toggleDrawer(force) {
  if (!mode) return;
  const open = force ?? document.documentElement.dataset.drawer !== 'open';
  if (open) document.documentElement.dataset.drawer = 'open';
  else delete document.documentElement.dataset.drawer;
  $('study-drawer')?.setAttribute('aria-pressed', String(open));
}

export function flipSide() {
  if (!mode) return;
  enterStudy(mode, side === 'right' ? 'left' : 'right');
}

// ── The picker sheet ─────────────────────────────────────────────

function renderSheet() {
  const $grid = $('study-cards');
  if (!$grid) return;
  $grid.textContent = '';
  for (const m of STUDY_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `study-card${mode === m.id ? ' active' : ''}`;
    b.dataset.mode = m.id;
    b.setAttribute('aria-label', `${m.n}. ${m.name}: ${m.hint}`);
    b.innerHTML = `<span class="study-card__n" aria-hidden="true">${m.n}</span>${layoutPicture(m.id)}`;
    const name = document.createElement('span');
    name.className = 'study-card__name';
    name.textContent = m.name;
    const hint = document.createElement('span');
    hint.className = 'study-card__hint';
    hint.textContent = m.hint;
    b.append(name, hint);
    b.addEventListener('click', () => enterStudy(m.id, side));
    $grid.appendChild(b);
  }
  for (const s of ['left', 'right']) {
    // The toggle names the LECTURE side, which is what students think about
    $(`study-lecture-${s}`)?.setAttribute('aria-pressed', String(side !== s));
  }
  $('study-off')?.classList.toggle('hidden', !mode);
  const $suggest = $('study-suggest');
  if ($suggest) $suggest.checked = getPrefs().studySuggest !== false;
}

export function openStudySheet() {
  hideSuggestion();
  renderSheet();
  $('study-sheet')?.classList.remove('hidden');
  setTimeout(() => $('study-cards')?.querySelector('.study-card.active, .study-card')?.focus(), 40);
}

export function closeStudySheet() {
  $('study-sheet')?.classList.add('hidden');
}

export function toggleStudySheet() {
  if ($('study-sheet')?.classList.contains('hidden')) openStudySheet();
  else closeStudySheet();
}

// ── Suggesting study mode when the window goes side by side ─────

export function showSuggestion(appSide) {
  const $card = $('study-suggestion');
  if (!$card) return;
  side = appSide;
  const $row = $('study-suggestion-modes');
  if ($row) {
    $row.textContent = '';
    for (const m of STUDY_MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'study-chip';
      b.title = `${m.name}: ${m.hint}`;
      b.setAttribute('aria-label', m.name);
      b.innerHTML = layoutPicture(m.id, appSide);
      b.addEventListener('click', () => enterStudy(m.id, appSide));
      $row.appendChild(b);
    }
  }
  $card.classList.remove('hidden');
}

function hideSuggestion() { $('study-suggestion')?.classList.add('hidden'); }

function onShape(shape) {
  if (!shape) return;
  // Maximizing again ends study mode (except Mini, which floats on purpose)
  if (mode && shape.maximized && mode !== 'mini') { exitStudy(); return; }
  if (mode) return;
  if (!shape.sideBySide) { hideSuggestion(); return; }
  if (getPrefs().studySuggest === false) return;
  if (Date.now() - suggestedAt < 10 * 60 * 1000) return; // at most every 10 minutes
  suggestedAt = Date.now();
  showSuggestion(shape.side);
}

export function initStudy() {
  const a = api();
  if (a?.onWindowShape) a.onWindowShape(onShape);
  else {
    // Browser: guess from the viewport
    let t = null;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const fraction = window.outerWidth / (window.screen.availWidth || window.outerWidth);
        onShape({ fraction, sideBySide: fraction <= 0.62, maximized: fraction > 0.95, side: window.screenX > window.screen.availWidth / 3 ? 'right' : 'left' });
      }, 300);
    });
  }
  const saved = getPrefs().study;
  if (saved?.side === 'left' || saved?.side === 'right') side = saved.side;

  $('btn-study')?.addEventListener('click', toggleStudySheet);
  $('study-bar-name')?.addEventListener('click', openStudySheet);
  $('study-flip')?.addEventListener('click', flipSide);
  $('study-drawer')?.addEventListener('click', () => toggleDrawer());
  $('study-exit')?.addEventListener('click', exitStudy);
  $('study-off')?.addEventListener('click', exitStudy);
  $('study-sheet-close')?.addEventListener('click', closeStudySheet);
  document.querySelector('#study-sheet .study-sheet__backdrop')?.addEventListener('click', closeStudySheet);
  for (const s of ['left', 'right']) {
    $(`study-lecture-${s}`)?.addEventListener('click', () => {
      side = s === 'left' ? 'right' : 'left';
      if (mode) enterStudy(mode, side);
      else renderSheet();
    });
  }
  $('study-suggest')?.addEventListener('change', (e) => setPrefs({ studySuggest: e.target.checked }));
  $('study-suggestion-more')?.addEventListener('click', openStudySheet);
  $('study-suggestion-close')?.addEventListener('click', hideSuggestion);
  $('study-suggestion-never')?.addEventListener('click', () => {
    setPrefs({ studySuggest: false });
    hideSuggestion();
    showToast('Study mode won\'t be suggested again. It is always in the top bar.', 'info', 3000);
  });

  // Number keys pick a layout while the sheet is open
  document.addEventListener('keydown', (e) => {
    const $sheet = $('study-sheet');
    if (!$sheet || $sheet.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeStudySheet(); return; }
    const m = STUDY_MODES.find((x) => String(x.n) === e.key);
    if (m && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); enterStudy(m.id, side); }
  });
  renderBar();
}

/**
 * THETA172 — the first start.
 *
 * Act 1, the introduction (about 9.5 s), in the THETA172 site's look:
 *   0.0 s  the light comes up on the dark
 *   0.5 s  the Ti mark's five blocks drop in
 *   1.5 s  a protractor draws itself round the mark
 *   2.1 s  the needle sweeps to θ = 172° (the name); the 172° mark lights
 *   4.3 s  the mark rises; the THETA172 wordmark draws itself
 *   5.0 s  the six divisions, then "Software for every domain."
 *   6.7 s  … presents: Python by THETA172
 * Act 2: "What should we call you?"
 * Act 3: "Namaste, <name>." — then the app starts.
 *
 * Skip (or Esc) jumps from the introduction to the name. Reduced motion
 * shows the finished picture instead of the moves.
 */

import { storageGet, storageSet } from '../core/storage.js';

const SEEN_KEY = 'theta-welcome-seen';
const NAME_KEY = 'theta-user-name';
const GOAL = 172;

const MARK_BLOCKS = [
  { x: 0, y: 60, w: 134, h: 40, d: 0 },
  { x: 51, y: 100, w: 48, h: 83, d: 140 },
  { x: 134, y: 100, w: 35, h: 83, d: 260 },
  { x: 141, y: 35, w: 26, h: 26, d: 470, dot: 'd1' },
  { x: 173, y: 0, w: 35, h: 34, d: 600, dot: 'd2' },
];
// The THETA172 wordmark (strokes), from the brand
const WORD = `<g stroke="#f4ede9"><path pathLength="1" d="M0 .6H10M5 .6V14"/><path pathLength="1" transform="translate(19 0)" d="M.6 0V14M9.4 0V14M.6 7H9.4"/><path pathLength="1" transform="translate(38 0)" d="M10 .6H.6V13.4H10M.6 7H9"/><path pathLength="1" transform="translate(57 0)" d="M0 .6H10M5 .6V14"/><path pathLength="1" transform="translate(76 0)" d="M0 14L5 .5L10 14"/></g><g stroke="#f4473a"><path pathLength="1" transform="translate(95 0)" d="M2.6 3.2L6.2 .6V14"/><path pathLength="1" transform="translate(114 0)" d="M.3 .6H9.6L3.8 14"/><path pathLength="1" transform="translate(133 0)" d="M.9 3.6C1.3 1.7 3 .6 5 .6c2.4 0 4.2 1.5 4.2 3.7 0 1.8-1 2.9-2.7 4.2L.8 13.4H10"/></g>`;
const DIVISIONS = ['Food', 'Education', 'Security', 'ML', 'Research', 'Labs'];

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  || document.documentElement.classList.contains('reduce-motion');

export const welcomeSeen = () => storageGet(SEEN_KEY) === '1';
export const userName = () => (storageGet(NAME_KEY) || '').trim();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The Ti mark as blocks (shared with the updating screen). */
export function markSvg(cls = 'th-mark') {
  const blocks = MARK_BLOCKS.map((b) => {
    const rect = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
    const inner = b.dot ? `<g class="lift"><g class="float">${rect}</g></g>` : rect;
    return `<g class="blk${b.dot ? ` ${b.dot}` : ''}" style="--d:${b.d}">${inner}</g>`;
  }).join('');
  return `<svg class="${cls}" viewBox="0 0 208 183" aria-hidden="true">${blocks}</svg>`;
}

/** The protractor round the mark (ticks, the 172° mark, needle, sweep). */
export function dialSvg() {
  const lines = [];
  for (let d = 0; d < 360; d += 10) {
    const major = d % 90 === 0;
    const a = (-d * Math.PI) / 180;
    const r0 = major ? 86 : 89;
    lines.push(`<line class="tick${major ? ' major' : ''}" style="--i:${d / 10}" x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * 94).toFixed(2)}" y2="${(Math.sin(a) * 94).toFixed(2)}"/>`);
  }
  const g = (-GOAL * Math.PI) / 180;
  lines.push(`<line class="tick goal" x1="${(Math.cos(g) * 80).toFixed(2)}" y1="${(Math.sin(g) * 80).toFixed(2)}" x2="${(Math.cos(g) * 99).toFixed(2)}" y2="${(Math.sin(g) * 99).toFixed(2)}"/>`);
  const lbl = (txt, d, r, cls = '') => {
    const b = (-d * Math.PI) / 180;
    return `<text class="lbl ${cls}" x="${(Math.cos(b) * r).toFixed(2)}" y="${(Math.sin(b) * r + 1.8).toFixed(2)}" text-anchor="middle">${txt}</text>`;
  };
  return `<svg class="th-proto" viewBox="-110 -110 220 220" aria-hidden="true">
    <circle class="ring" r="94" pathLength="1"/><circle class="ring ring--dots" r="78" stroke-dasharray="1 3"/>
    <g class="ticks">${lines.join('')}</g>
    ${lbl('0°', 0, 106)}${lbl('90°', 90, 105)}${lbl('270°', 270, 106)}${lbl('172°', GOAL + 6.5, 106, 'goal')}
    <circle class="goal-ping" cx="${(Math.cos(g) * 94).toFixed(2)}" cy="${(Math.sin(g) * 94).toFixed(2)}" r="3"/>
    <path class="sweep" d=""/>
    <g class="needle"><line x1="70" y1="0" x2="97" y2="0"/><rect x="96" y="-1.5" width="3" height="3"/></g>
  </svg>`;
}

/** Arc from 0° to `deg` on the protractor (SVG path). */
export function arcPath(deg, r = 82) {
  if (deg < 0.5) return '';
  const d = Math.min(deg, 359.9);
  const a = (-d * Math.PI) / 180;
  return `M${r} 0A${r} ${r} 0 ${d > 180 ? 1 : 0} 0 ${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;
}

/**
 * Play the first start. Resolves when the app should start.
 * @param {{ force?: boolean, onName?: (name: string) => void }} [opts]
 */
export function playWelcome({ force = false, onName } = {}) {
  if (!force && welcomeSeen()) return Promise.resolve(false);
  storageSet(SEEN_KEY, '1');
  document.getElementById('welcome')?.remove();
  const reduce = reducedMotion();

  const stage = document.createElement('div');
  stage.id = 'welcome';
  stage.className = `th${reduce ? ' th--still' : ''}`;
  stage.setAttribute('role', 'dialog');
  stage.setAttribute('aria-modal', 'true');
  stage.setAttribute('aria-label', 'Welcome to Python by THETA172');
  const divisions = DIVISIONS.map((d, i) => `<span style="--i:${i}">${d}</span>`).join('<i aria-hidden="true">·</i>');
  const python = [...'Python'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('');
  // Static markup only; the name is added later, escaped
  stage.innerHTML = `
    <div class="th-act th-intro" aria-hidden="true">
      <div class="th-hero">
        <div class="th-dial">${dialSvg()}<div class="th-markbox">${markSvg()}</div></div>
        <p class="th-readout"><span class="th-theta">θ</span> = <span class="th-deg">000°</span></p>
      </div>
      <div class="th-brand">
        <svg class="th-word" viewBox="-1 -1 145 16" fill="none" stroke-width=".9" stroke-linejoin="miter">${WORD}</svg>
        <p class="th-divisions">${divisions}</p>
        <p class="th-tag">Software for every domain<span class="th-sq"></span></p>
      </div>
      <div class="th-presents">
        <p class="th-eyebrow">THETA172 presents</p>
        <h1 class="th-python">${python}</h1>
        <span class="th-rule" aria-hidden="true"></span>
        <p class="th-by"><span>by</span><svg class="th-word th-word--small" viewBox="-1 -1 145 16" fill="none" stroke-width="1.5">${WORD}</svg></p>
        <p class="th-what">One Python IDE to learn, teach and build.</p>
      </div>
    </div>
    <form class="th-act th-name" autocomplete="off" hidden>
      <div class="th-corner">${markSvg('th-mark th-mark--still')}</div>
      <p class="th-eyebrow">Hello</p>
      <h2 class="th-ask"><label for="th-name-input">What should we call you?</label></h2>
      <input id="th-name-input" class="th-input" type="text" maxlength="40" spellcheck="false" placeholder="Your name" />
      <p class="th-hint">It stays on this computer. Your teacher sees it when you join a class.</p>
      <div class="th-actions">
        <button class="th-btn th-btn--go" type="submit">Continue <span aria-hidden="true">→</span></button>
        <button class="th-btn th-btn--ghost" type="button" data-skip-name>Skip</button>
      </div>
    </form>
    <div class="th-act th-hello" hidden aria-live="polite">
      <p class="th-eyebrow">Welcome</p>
      <h2 class="th-namaste"></h2>
      <p class="th-hello-sub">You are all set in <b>Python by THETA172</b>.</p>
      <p class="th-hello-sub th-hello-sub--2">Your first program is one click away.</p>
    </div>
    <button class="th-skip" type="button">Skip intro <span aria-hidden="true">→</span></button>
  `;
  document.body.append(stage);
  const $ = (s) => stage.querySelector(s);
  const intro = $('.th-intro');
  const form = $('.th-name');
  const hello = $('.th-hello');
  const skipBtn = $('.th-skip');
  const timers = [];
  const later = (ms, fn) => { timers.push(setTimeout(fn, reduce ? Math.min(ms, 250) : ms)); };

  return new Promise((resolve) => {
    let phase = 'intro';
    let raf = 0;

    // ── Act 1 ──
    requestAnimationFrame(() => stage.classList.add('is-on')); // the light comes up
    const mark = $('.th-intro .th-mark');
    later(500, () => mark.classList.add('go'));

    // The needle: 0° → 172°, eased, with the reading counting up
    const needle = $('.th-intro .needle');
    const sweep = $('.th-intro .sweep');
    const deg = $('.th-deg');
    const hero = $('.th-hero');
    const SWEEP_MS = 1600;
    const runSweep = () => {
      const t0 = performance.now();
      const step = (now) => {
        const k = reduce ? 1 : Math.min(1, (now - t0) / SWEEP_MS);
        const theta = GOAL * (1 - (1 - k) ** 4);
        needle.setAttribute('transform', `rotate(${(-theta).toFixed(2)})`);
        sweep.setAttribute('d', arcPath(theta));
        deg.textContent = `${String(Math.round(theta)).padStart(3, '0')}°`;
        if (k < 1) raf = requestAnimationFrame(step);
        else hero.classList.add('found');
      };
      raf = requestAnimationFrame(step);
    };

    later(1500, () => stage.classList.add('is-dial'));
    later(2100, () => { stage.classList.add('is-sweep'); runSweep(); });
    later(4300, () => stage.classList.add('is-brand'));
    later(6700, () => stage.classList.add('is-presents'));
    later(9600, () => toName());

    // ── Act 2 ──
    const input = $('#th-name-input');
    input.value = userName();
    function toName() {
      if (phase !== 'intro') return;
      phase = 'name';
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      skipBtn.hidden = true;
      intro.classList.add('is-out');
      setTimeout(() => {
        intro.hidden = true;
        form.hidden = false;
        form.classList.add('is-in');
        input.focus({ preventScroll: true });
      }, reduce ? 0 : 500);
    }
    const submit = (name) => {
      if (phase !== 'name') return;
      phase = 'hello';
      // eslint-disable-next-line no-control-regex
      const clean = String(name || '').replace(/[\u0000-\u001F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (clean) storageSet(NAME_KEY, clean);
      onName?.(clean);
      toHello(clean);
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
    $('[data-skip-name]').addEventListener('click', () => submit(''));

    // ── Act 3 ──
    function toHello(name) {
      form.classList.add('is-out');
      setTimeout(() => {
        form.hidden = true;
        const h = $('.th-namaste');
        const words = name ? `Namaste, ${name}.` : 'Namaste.';
        h.innerHTML = [...words].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
        hello.hidden = false;
        hello.classList.add('is-in');
        setTimeout(finish, reduce ? 1600 : 3600);
      }, reduce ? 0 : 450);
    }

    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      stage.classList.add('is-leaving');
      setTimeout(() => { stage.remove(); resolve(true); }, 800);
    }

    const onKey = (e) => {
      if (e.key === 'Escape' && phase === 'intro') { e.preventDefault(); e.stopPropagation(); toName(); }
      if (phase === 'hello' && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); finish(); }
    };
    document.addEventListener('keydown', onKey, true);
    skipBtn.addEventListener('click', () => toName());
    skipBtn.focus({ preventScroll: true });
  });
}

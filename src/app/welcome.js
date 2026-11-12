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
const WORD = `<g stroke="#f4ede9"><path pathLength="1" d="M0 .6H10M5 .6V14"/><path pathLength="1" transform="translate(19 0)" d="M.6 0V14M9.4 0V14M.6 7H9.4"/><path pathLength="1" transform="translate(38 0)" d="M10 .6H.6V13.4H10M.6 7H9"/><path pathLength="1" transform="translate(57 0)" d="M0 .6H10M5 .6V14"/><path pathLength="1" transform="translate(76 0)" d="M0 14L5 .5L10 14"/></g><g stroke="#E3262D"><path pathLength="1" transform="translate(95 0)" d="M2.6 3.2L6.2 .6V14"/><path pathLength="1" transform="translate(114 0)" d="M.3 .6H9.6L3.8 14"/><path pathLength="1" transform="translate(133 0)" d="M.9 3.6C1.3 1.7 3 .6 5 .6c2.4 0 4.2 1.5 4.2 3.7 0 1.8-1 2.9-2.7 4.2L.8 13.4H10"/></g>`;
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

/** The mark sketched in pen, then inked (the start-up screen and the updating screen). */
export function sketchMarkSvg(cls = 'boot-sketch') {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
  const j = (v) => +(v + rnd() * 1.6).toFixed(1);
  const parts = MARK_BLOCKS.map((b, i) => {
    const d = `M${j(b.x - 2)} ${j(b.y + 1)} L${j(b.x + b.w)} ${j(b.y)} L${j(b.x + b.w)} ${j(b.y + b.h)} L${j(b.x)} ${j(b.y + b.h)} L${j(b.x + 1)} ${j(b.y - 2)}`;
    return `<rect class="bk-ink" style="--i:${i}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/><path class="bk-pen" style="--i:${i}" pathLength="1" d="${d}"/>`;
  }).join('');
  return `<svg class="${cls}" viewBox="-8 -8 226 196" aria-hidden="true">${parts}</svg>`;
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
 * @param {{ force?: boolean, onName?: (name: string) => void, onTheme?: (theme: 'playground'|'pro') => void }} [opts]
 */
export function playWelcome({ force = false, onName, onTheme, onRole } = {}) {
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
    <div class="th-setup" hidden>
      <div class="th-corner">${markSvg('th-mark th-mark--still')}</div>
      <div class="th-steps" aria-hidden="true"><i class="is-on"></i><i></i><i></i></div>
    </div>
    <form class="th-act th-name" autocomplete="off" hidden>
      <p class="th-eyebrow">Step 1 of 3</p>
      <h2 class="th-ask"><label for="th-name-input">What should we call you?</label></h2>
      <input id="th-name-input" class="th-input" type="text" maxlength="40" spellcheck="false" placeholder="Your name" />
      <p class="th-hint">It stays on this computer. Your teacher sees it when you join a class.</p>
      <div class="th-actions">
        <button class="th-btn th-btn--go" type="submit">Continue <span aria-hidden="true">→</span></button>
        <button class="th-btn th-btn--ghost" type="button" data-skip-name>Skip</button>
      </div>
    </form>
    <form class="th-act th-role" hidden>
      <p class="th-eyebrow">Step 2 of 3</p>
      <h2 class="th-ask">What brings you here?</h2>
      <p class="th-hint">We will set things up for you. You can use everything either way.</p>
      <div class="th-roles" role="radiogroup" aria-label="What brings you here">
        <button class="th-role-card" type="button" role="radio" aria-checked="true" data-role="learn">
          <span class="th-role-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4z"/><path d="M7 9v5c0 1.5 2.2 3 5 3s5-1.5 5-3V9"/></svg></span>
          <b>Learning Python</b><small>School, college or on my own</small>
        </button>
        <button class="th-role-card" type="button" role="radio" aria-checked="false" data-role="teach">
          <span class="th-role-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/><path d="M7 9h6M7 12h4"/></svg></span>
          <b>Teaching a class</b><small>Live classes, help requests, hand-ins</small>
        </button>
        <button class="th-role-card" type="button" role="radio" aria-checked="false" data-role="build">
          <span class="th-role-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg></span>
          <b>Building and data</b><small>Projects, notebooks, tests, debugging</small>
        </button>
      </div>
      <div class="th-actions">
        <button class="th-btn th-btn--go" type="submit">Continue <span aria-hidden="true">→</span></button>
        <button class="th-btn th-btn--ghost" type="button" data-back-role>Back</button>
      </div>
    </form>
    <form class="th-act th-look" hidden>
      <p class="th-eyebrow">Step 3 of 3</p>
      <h2 class="th-ask">Choose your look</h2>
      <p class="th-hint">We picked one for you. You can switch any time from the top bar.</p>
      <div class="th-looks" role="radiogroup" aria-label="Look">
        <button class="th-look-card" type="button" role="radio" aria-checked="true" data-look="playground">
          <span class="th-look-prev th-look-prev--play" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <b>Playground <em class="th-rec" data-rec="playground">Recommended for you</em></b>
          <small>Bright and friendly. Made for learning and for class.</small>
        </button>
        <button class="th-look-card" type="button" role="radio" aria-checked="false" data-look="pro">
          <span class="th-look-prev th-look-prev--pro" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <b>Pro <em class="th-rec" data-rec="pro">Recommended for you</em></b>
          <small>Quiet graphite, dense and keyboard-first. Made for data and ML work.</small>
        </button>
      </div>
      <div class="th-actions">
        <button class="th-btn th-btn--go" type="submit">Continue <span aria-hidden="true">→</span></button>
        <button class="th-btn th-btn--ghost" type="button" data-back>Back</button>
      </div>
    </form>
    <div class="th-act th-hello" hidden aria-live="polite">
      <p class="th-eyebrow">Welcome</p>
      <h2 class="th-namaste"></h2>
      <p class="th-hello-sub">Your Python IDE is ready.</p>
      <p class="th-hello-sub th-hello-sub--2">Let's run your first program.</p>
    </div>
    <button class="th-skip" type="button">Skip intro <span aria-hidden="true">→</span></button>
  `;
  document.body.append(stage);
  const $ = (s) => stage.querySelector(s);
  const intro = $('.th-intro');
  const form = $('.th-name');
  const look = $('.th-look');
  const roleForm = $('.th-role');
  const setup = $('.th-setup');
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
        setup.hidden = false;
        form.hidden = false;
        form.classList.add('is-in');
        input.focus({ preventScroll: true });
      }, reduce ? 0 : 500);
    }
    let chosenName = '';
    const submit = (name) => {
      if (phase !== 'name') return;
      const clean = String(name || '').replace(/[\u0000-\u001F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (clean) storageSet(NAME_KEY, clean);
      chosenName = clean;
      onName?.(clean);
      swap(form, roleForm, 1, () => roleCards.find((c) => c.dataset.role === role).focus({ preventScroll: true }));
      phase = 'role';
    };

    /** Move from one step to the next (or back), with the progress line. */
    function swap(from, to, step, after) {
      from.classList.add('is-out');
      setTimeout(() => {
        from.hidden = true;
        from.classList.remove('is-out', 'is-in');
        dots().forEach((d, k) => d.classList.toggle('is-on', k <= step));
        to.hidden = false;
        to.classList.remove('is-out');
        to.classList.add('is-in');
        after?.();
      }, reduce ? 0 : 380);
    }

    // ── Act 2a: what brings you here (it picks the recommended look) ──
    const RECOMMEND = { learn: 'playground', teach: 'playground', build: 'pro' };
    let role = storageGet('theta-user-role') || 'learn';
    if (!RECOMMEND[role]) role = 'learn';
    const roleCards = [...roleForm.querySelectorAll('.th-role-card')];
    const paintRole = () => roleCards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.role === role)));
    roleCards.forEach((c) => c.addEventListener('click', () => { role = c.dataset.role; paintRole(); }));
    roleForm.querySelector('.th-roles').addEventListener('keydown', (e) => {
      const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (!keys[e.key]) return;
      e.preventDefault();
      const order = roleCards.map((c) => c.dataset.role);
      role = order[(order.indexOf(role) + keys[e.key] + order.length) % order.length];
      paintRole();
      roleCards.find((c) => c.dataset.role === role).focus();
    });
    paintRole();
    roleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (phase !== 'role') return;
      storageSet('theta-user-role', role);
      onRole?.(role);
      theme = RECOMMEND[role];
      paintLook();
      look.querySelectorAll('.th-rec').forEach((r) => { r.hidden = r.dataset.rec !== theme; });
      phase = 'look';
      swap(roleForm, look, 2, () => cards.find((c) => c.dataset.look === theme).focus({ preventScroll: true }));
    });
    roleForm.querySelector('[data-back-role]').addEventListener('click', () => {
      if (phase !== 'role') return;
      phase = 'name';
      swap(roleForm, form, 0, () => input.focus({ preventScroll: true }));
    });

    // ── Act 2b: your look ──
    let theme = document.documentElement.dataset.theme === 'pro' ? 'pro' : 'playground';
    const cards = [...look.querySelectorAll('.th-look-card')];
    const paintLook = () => cards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.look === theme)));
    cards.forEach((c) => c.addEventListener('click', () => { theme = c.dataset.look; paintLook(); }));
    look.querySelector('.th-looks').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      theme = theme === 'pro' ? 'playground' : 'pro';
      paintLook();
      cards.find((c) => c.dataset.look === theme).focus();
    });
    paintLook();
    const dots = () => [...stage.querySelectorAll('.th-steps i')];
    look.addEventListener('submit', (e) => {
      e.preventDefault();
      if (phase !== 'look') return;
      phase = 'hello';
      onTheme?.(theme);
      toHello(chosenName);
    });
    look.querySelector('[data-back]').addEventListener('click', () => {
      if (phase !== 'look') return;
      phase = 'role';
      swap(look, roleForm, 1, () => roleCards.find((c) => c.dataset.role === role).focus({ preventScroll: true }));
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
    $('[data-skip-name]').addEventListener('click', () => submit(''));

    // ── Act 3 ──
    function toHello(name) {
      look.classList.add('is-out');
      setup.classList.add('is-out');
      setTimeout(() => {
        look.hidden = true;
        setup.hidden = true;
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
      setTimeout(() => { stage.remove(); resolve({ name: chosenName, role, theme }); }, 800);
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

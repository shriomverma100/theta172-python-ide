/**
 * THETA172 — the startup guide: a short spotlight tour of the platform.
 *
 * Starts once, right after the first theme choice; Help → Take the Tour
 * replays it. Each stop lights one part of the screen and says, in a
 * sentence or two, what it is for. The same stops work in Playground and
 * Pro: each names the places it can point at and the first one on screen
 * is used. Keys: → or Enter next, ← back, Esc to close.
 */

import { storageGet, storageSet } from '../core/storage.js';
import { userName } from './welcome.js';

const SEEN_KEY = 'theta-tour-seen';
export const tourSeen = () => storageGet(SEEN_KEY) === '1';

const STOPS = [
  {
    title: (n) => (n ? `${n}, here is your IDE` : 'Here is your IDE'),
    body: 'A one-minute tour of the main parts. You can leave it at any time and replay it from Help → Take the Tour.',
  },
  {
    at: ['#editor-pane'],
    kicker: 'Write',
    title: 'The editor',
    body: 'Write Python here. Python 3.12 is built in, so there is nothing to install. It completes names as you type, marks mistakes before you run, and Split shows two files side by side.',
    keys: ['Ctrl', 'N'],
  },
  {
    at: ['.ide-topbar #btn-run', '#btn-run-rail', '#btn-run'],
    kicker: 'Run',
    title: 'Run your program',
    body: 'Runs the file you are in. Programs that ask for input() wait for you in the Output panel.',
    keys: ['Ctrl', 'Enter'],
  },
  {
    at: ['#terminal-pane'],
    kicker: 'See',
    title: 'Output, REPL and Shell',
    body: 'Output shows what your program prints. REPL runs Python one line at a time. Shell is the system terminal. Type a package name such as pandas in the pip install box to add it.',
  },
  {
    at: ['#terminal-pane'],
    kicker: 'Understand',
    title: 'Errors, explained',
    body: 'When a program fails, a card names the line, says what went wrong and how to fix it, in English or हिंदी. Missing packages get an Install button.',
  },
  {
    at: ['#btn-predict', '.btn-predict--top'],
    kicker: 'Think first',
    title: 'Predict, then run',
    body: 'Write what you expect the program to print, then run it and see the difference line by line. It is the fastest way to really understand code.',
  },
  {
    at: ['#sidebar', '.ide-rail'],
    kicker: 'Projects',
    title: 'Files, search, Git, tests, debugger',
    body: 'Open a project folder to see its files. The same side bar searches every file, commits with Git, runs pytest tests and steps through code with the debugger (F9 for a breakpoint, F5 to start).',
    keys: ['Ctrl', 'Shift', 'O'],
  },
  {
    at: ['.class-tile', '#rail-classroom', '#btn-classroom'],
    kicker: 'Together',
    title: 'Classroom',
    body: 'Teachers start a live class and see every student\'s code; students follow along and ask for help. It works on the same Wi-Fi, and from anywhere with your school\'s relay.',
  },
  {
    at: ['#btn-palette', '.menubar__all', '#menubar'],
    kicker: 'Find anything',
    title: 'Every action, one search away',
    body: 'The command palette finds every action in the app: notebooks, tests, Chain Lens, plugins, settings. The menus hold the same things.',
    keys: ['Ctrl', 'Shift', 'P'],
  },
  {
    at: ['.ide-topbar .theme-switch', '.theme-switch', '#btn-settings', '#rail-settings'],
    kicker: 'Make it yours',
    title: 'Playground or Pro',
    body: 'Switch between the bright Playground and the quiet Pro at any time. Settings hold editor colours, text size, word wrap and automatic updates.',
  },
  {
    title: () => 'You are ready',
    body: 'Press Run to try the example in the editor, or start a new file with Ctrl + N. Help → Take the Tour shows this again.',
    last: true,
  },
];

const visible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
};
const find = (list = []) => {
  for (const sel of list) {
    for (const el of document.querySelectorAll(sel)) if (visible(el)) return el;
  }
  return null;
};
const elm = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let open = null;

/** Start the tour. Resolves when it is closed. */
export function startTour({ force = false } = {}) {
  if (open) return open.done;
  if (!force && tourSeen()) return Promise.resolve(false);
  storageSet(SEEN_KEY, '1');

  const root = elm('div', 'tour');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tour-title');
  const shade = elm('div', 'tour__shade'); // the dim around the light
  const spot = elm('div', 'tour__spot');
  const card = elm('section', 'tour__card');
  const top = elm('div', 'tour__top');
  const kicker = elm('span', 'tour__kicker');
  const count = elm('span', 'tour__count');
  top.append(kicker, count);
  const title = elm('h2', 'tour__title');
  title.id = 'tour-title';
  const body = elm('p', 'tour__body');
  const keys = elm('p', 'tour__keys');
  const bar = elm('div', 'tour__bar');
  const fill = elm('span', 'tour__fill');
  bar.append(fill);
  const actions = elm('div', 'tour__actions');
  const skip = elm('button', 'tour__btn tour__btn--quiet', 'Skip tour');
  const back = elm('button', 'tour__btn', 'Back');
  const next = elm('button', 'tour__btn tour__btn--go', 'Next');
  for (const b of [skip, back, next]) b.type = 'button';
  const spacer = elm('span', 'tour__spacer');
  actions.append(skip, spacer, back, next);
  card.append(top, title, body, keys, bar, actions);
  root.append(shade, spot, card);
  document.body.append(root);

  let i = 0;
  let target = null;
  const name = userName();

  const place = () => {
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!target) {
      root.classList.add('is-center');
      spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
      card.style.left = `${Math.round((vw - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.round((vh - card.offsetHeight) / 2)}px`;
      return;
    }
    root.classList.remove('is-center');
    const r = target.getBoundingClientRect();
    const x = Math.max(4, r.left - pad);
    const y = Math.max(4, r.top - pad);
    const w = Math.min(vw - 8, r.width + pad * 2);
    const h = Math.min(vh - 8, r.height + pad * 2);
    spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    // The card goes where there is most room: right, left, below, above, or inside a big target
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 16;
    const room = { right: vw - (x + w), left: x, below: vh - (y + h), above: y };
    let left;
    let top2;
    if (room.right >= cw + gap * 2) { left = x + w + gap; top2 = y + Math.min(24, h / 4); }
    else if (room.left >= cw + gap * 2) { left = x - cw - gap; top2 = y + Math.min(24, h / 4); }
    else if (room.below >= ch + gap * 2) { left = x + w / 2 - cw / 2; top2 = y + h + gap; }
    else if (room.above >= ch + gap * 2) { left = x + w / 2 - cw / 2; top2 = y - ch - gap; }
    else { left = x + w - cw - gap; top2 = y + h - ch - gap; }
    card.style.left = `${Math.round(Math.max(12, Math.min(vw - cw - 12, left)))}px`;
    card.style.top = `${Math.round(Math.max(12, Math.min(vh - ch - 12, top2)))}px`;
  };

  const show = (n, dir = 1) => {
    i = Math.max(0, Math.min(STOPS.length - 1, n));
    const s = STOPS[i];
    target = s.at ? find(s.at) : null;
    // A stop whose part is not on screen (e.g. a hidden panel) is skipped
    if (s.at && !target) { show(i + dir, dir); return; }
    card.classList.remove('is-in');
    void card.offsetWidth;
    kicker.textContent = s.kicker || (i === 0 ? 'Welcome' : 'Done');
    count.textContent = i === 0 || s.last ? '' : `${i} / ${STOPS.length - 2}`;
    title.textContent = typeof s.title === 'function' ? s.title(name) : s.title;
    body.textContent = s.body;
    keys.replaceChildren();
    if (s.keys) {
      s.keys.forEach((k, j) => { if (j) keys.append(elm('span', 'tour__plus', '+')); keys.append(elm('kbd', '', k)); });
    }
    keys.hidden = !s.keys;
    fill.style.width = `${Math.round((i / (STOPS.length - 1)) * 100)}%`;
    back.hidden = i === 0 || !!s.last;
    skip.hidden = !!s.last;
    next.textContent = i === 0 ? 'Start the tour' : s.last ? 'Start coding' : 'Next';
    skip.textContent = i === 0 ? 'Not now' : 'Skip tour';
    card.classList.add('is-in');
    place();
    next.focus({ preventScroll: true });
  };

  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const close = () => {
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey, true);
    root.classList.add('is-out');
    setTimeout(() => root.remove(), 260);
    open = null;
    resolveDone(true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight' || (e.key === 'Enter' && document.activeElement === next)) { e.preventDefault(); e.stopPropagation(); go(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); }
  };
  const go = (d) => {
    if (d > 0 && STOPS[i].last) { close(); return; }
    show(i + d, d);
  };
  next.addEventListener('click', () => go(1));
  back.addEventListener('click', () => go(-1));
  skip.addEventListener('click', close);
  shade.addEventListener('mousedown', (e) => e.preventDefault());
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => { root.classList.add('is-on'); show(0); });
  open = { done, close, show: (n) => show(n) };
  return done;
}

/** Test hook: jump to a stop. */
export const _tourShow = (n) => open?.show(n);

// ═══ First program: the moment the platform proves itself ═══
// After the welcome, the editor holds the user's own first program and Run
// is lit. When it runs, a short celebration offers the tour (never forced).

const FIRST_CODE = {
  learn: (n) => `# Your first program${n ? `, ${n}` : ''}\nname = "${n || 'friend'}"\nprint(f"Namaste, {name}! Welcome to Python.")\n\n# Change the name above and press Run again.\n`,
  teach: (n) => `# A first program for your class${n ? `, ${n}` : ''}\nstudents = ["Aarav", "Diya", "Kabir"]\nfor s in students:\n    print(f"Welcome to class, {s}!")\n\n# Open Classroom to share your code live with every student.\n`,
  build: (n) => `# A quick start${n ? `, ${n}` : ''}\nscores = [72, 85, 91, 64, 88]\naverage = sum(scores) / len(scores)\nprint(f"{len(scores)} scores, average {average:.1f}, best {max(scores)}")\n\n# Open a folder (Ctrl+Shift+O) to work on a whole project.\n`,
};

/**
 * @param {{ name?: string, role?: 'learn'|'teach'|'build', setCode: (code: string) => void, onRun: (fn: (run: { ok: boolean }) => void) => (() => void) }} opts
 */
export function startFirstProgram({ name = '', role = 'learn', setCode, onRun }) {
  const safe = String(name).replace(/["\\]/g, '');
  setCode((FIRST_CODE[role] || FIRST_CODE.learn)(safe));
  const runBtn = find(['.ide-topbar #btn-run', '#btn-run-rail', '#btn-run']);
  if (!runBtn) return;

  const root = elm('div', 'tour tour--coach is-on');
  const spot = elm('div', 'tour__spot tour__spot--pulse');
  const card = elm('section', 'tour__card is-in');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-labelledby', 'coach-title');
  const kicker = elm('span', 'tour__kicker', 'Your first program');
  const title = elm('h2', 'tour__title', 'Press Run');
  title.id = 'coach-title';
  const body = elm('p', 'tour__body', 'We wrote a tiny program for you. Run it and see the result below.');
  const keys = elm('p', 'tour__keys');
  keys.append(elm('kbd', '', 'Ctrl'), elm('span', 'tour__plus', '+'), elm('kbd', '', 'Enter'));
  const actions = elm('div', 'tour__actions');
  const later = elm('button', 'tour__btn tour__btn--quiet', 'Not now');
  later.type = 'button';
  actions.append(later);
  card.append(kicker, title, body, keys, actions);
  root.append(spot, card);
  document.body.append(root);

  const place = () => {
    const r = runBtn.getBoundingClientRect();
    const pad = 6;
    spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px;`;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const below = r.bottom + 16 + ch < window.innerHeight;
    const top = below ? r.bottom + 16 : r.top - ch - 16;
    const left = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left + r.width / 2 - cw / 2));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(Math.max(12, top))}px`;
  };
  place();
  window.addEventListener('resize', place);

  let off = null;
  const close = () => {
    window.removeEventListener('resize', place);
    off?.();
    root.classList.add('is-out');
    setTimeout(() => root.remove(), 260);
  };
  later.addEventListener('click', close);

  off = onRun((run) => {
    if (!run.ok) {
      title.textContent = 'Almost';
      body.textContent = 'Something in the code changed. The card below the output explains what went wrong; fix it and press Run again.';
      return;
    }
    // The peak: say it plainly, then offer more
    spot.remove();
    card.classList.remove('is-in');
    void card.offsetWidth;
    card.classList.add('is-in', 'tour__card--done');
    kicker.textContent = 'Done';
    title.textContent = name ? `You just ran Python, ${name}.` : 'You just ran Python.';
    body.textContent = role === 'teach'
      ? 'Next: a one-minute tour of the IDE, including the Classroom where your students join.'
      : 'Next: a one-minute tour of the main parts, so you know where everything is.';
    keys.hidden = true;
    actions.replaceChildren();
    const skip = elm('button', 'tour__btn tour__btn--quiet', 'Start coding');
    const go = elm('button', 'tour__btn tour__btn--go', 'Show me around');
    skip.type = 'button';
    go.type = 'button';
    actions.append(skip, elm('span', 'tour__spacer'), go);
    skip.addEventListener('click', () => { storageSet(SEEN_KEY, '1'); close(); });
    go.addEventListener('click', () => { close(); setTimeout(() => startTour({ force: true }), 300); });
    place();
    go.focus({ preventScroll: true });
  });
}

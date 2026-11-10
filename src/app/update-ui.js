/**
 * THETA172 — updates in the window.
 *
 * The main process downloads a new version quietly (electron/updater.cjs).
 * When it is ready, and the user is not in a live class, running a program
 * or debugging, a card asks: "Update now" or "Later" (no Later for a
 * critical update). "Update now" saves open files and shows the updating
 * screen in the THETA172 look: the protractor's needle and red arc show the
 * progress, pixel effects mark each step, and a new Python card appears
 * every 7 seconds (English or हिंदी). Then the app restarts as the new
 * version and shows what is new.
 *
 * Help → Check for updates shows the same screen while it downloads.
 */

import { TIPS, KIND_LABEL } from './update-tips.js';
import { showToast } from '../toast.js';
import { getExplainLang, setExplainLang } from '../learn/learn-ui.js';
import { hasUnsavedTabs } from './tabs.js';
import { markSvg, dialSvg, arcPath, reducedMotion } from './welcome.js';

const api = () => window.electronAPI;
const LATER_MS = 4 * 60 * 60 * 1000; // "Later" asks again after 4 hours (or at the next start)
const BUSY_RECHECK_MS = 20_000;
const TIP_MS = 7000;

let info = null;            // from update-info
let status = { state: 'idle' };
let laterUntil = 0;
let askTimer = null;
let saveAll = async () => {};
let screen = null;          // the updating screen, when open

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (cls, text, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

/** A live class, a running program or a debug session: not a good moment. */
export function isBusy() {
  if (document.getElementById('cr-editor-toolbar')) return true;
  if (document.getElementById('run-status')?.classList.contains('run-status--running')) return true;
  const dbg = document.getElementById('debug-toolbar');
  if (dbg && !dbg.classList.contains('hidden')) return true;
  return false;
}

/**
 * @param {{ saveAll?: () => Promise<void>|void }} [deps]
 */
export async function initUpdates(deps = {}) {
  if (deps.saveAll) saveAll = deps.saveAll;
  const a = api();
  if (!a?.updateInfo) return;
  try { info = await a.updateInfo(); } catch (_) { return; }
  status = info.status || status;
  wireSettings();
  a.onUpdateStatus?.((s) => onStatus(s));
  if (info.whatsNew && info.updatedFrom) setTimeout(() => showWhatsNew(info.whatsNew), 2500);
  else if (info.updatedFrom) setTimeout(() => showToast(`Updated to version ${info.version}`, 'success', 3500), 2500);
  onStatus(status);
}

function onStatus(s) {
  const was = status.state;
  status = s || { state: 'idle' };
  if (screen) screen.update(status);
  if (status.state === 'ready') scheduleAsk();
  if (status.state === 'latest' && was !== 'latest') {
    showToast(`You have the latest version (${info?.version || ''}).`, 'success', 3000);
  }
  if (status.state === 'error' && status.message) {
    if (screen) screen.update(status);
    else showToast(status.message, 'error', 4000);
  }
}

function scheduleAsk() {
  clearTimeout(askTimer);
  if (screen || document.getElementById('update-card')) return;
  const wait = Math.max(0, laterUntil - Date.now());
  if (!status.critical && wait > 0) { askTimer = setTimeout(scheduleAsk, wait); return; }
  if (isBusy()) { askTimer = setTimeout(scheduleAsk, BUSY_RECHECK_MS); return; }
  showUpdateCard();
}

// ── The card: "Update ready" ──────────────────────────────────────

function showUpdateCard() {
  document.getElementById('update-card')?.remove();
  const card = el('section', `update-card${status.critical ? ' is-critical' : ''}`);
  card.id = 'update-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-labelledby', 'update-card-title');
  const mark = el('span', 'update-card__mark');
  mark.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3v11M7 9.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const words = el('div', 'update-card__words');
  const title = el('h2', 'update-card__title', status.critical ? 'Important update ready' : 'New update available');
  title.id = 'update-card-title';
  words.append(title, el('p', 'update-card__sub', `Version ${status.version} is ready to install. You have ${info?.version || 'an older version'}.`));
  const notes = (status.notes || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5);
  if (notes.length) {
    const ul = el('ul', 'update-card__notes');
    for (const n of notes) ul.append(el('li', '', n.replace(/^[•*-]\s*/, '').replace(/\[critical\]/i, '').trim()));
    words.append(ul);
  }
  if (status.critical) words.append(el('p', 'update-card__critical', 'This update fixes an important problem, so it cannot wait.'));
  const actions = el('div', 'update-card__actions');
  const now = btn('update-btn update-btn--primary', 'Update now', () => { card.remove(); startUpdate(); });
  actions.append(now);
  if (!status.critical) {
    actions.append(btn('update-btn', 'Later', () => {
      card.remove();
      laterUntil = Date.now() + LATER_MS;
      scheduleAsk();
      showToast('It will also install by itself the next time you close the app.', 'info', 3500);
    }));
  }
  card.append(mark, words, actions);
  document.body.append(card);
  now.focus({ preventScroll: true });
}

async function startUpdate() {
  if (hasUnsavedTabs()) {
    try { await saveAll(); } catch (_) { /* the save dialog was cancelled */ }
    if (hasUnsavedTabs()) {
      showToast('Save or close your files first, then choose Update now again.', 'error', 4000);
      laterUntil = 0;
      setTimeout(scheduleAsk, 1500);
      return;
    }
  }
  openScreen();
  if (status.state === 'ready') {
    const ok = await api().updateInstall();
    if (!ok) screen?.update({ state: 'error', message: 'The update could not start. It will install when you close the app.' });
  }
}

/** Help → Check for updates */
export async function checkForUpdates() {
  const a = api();
  if (!a?.updateCheck) return;
  if (status.state === 'ready') { showUpdateCard(); return; }
  if (status.state === 'downloading') { openScreen({ manual: true }); return; }
  const r = await a.updateCheck();
  if (!r?.ok) { showToast(r?.message || 'Could not check for updates.', 'info', 3500); return; }
  showToast('Checking for updates…', 'info', 1800);
  // Show the screen if a download starts
  const watch = setInterval(() => {
    if (status.state === 'downloading' && !screen) { openScreen({ manual: true }); clearInterval(watch); }
    if (['idle', 'latest', 'error', 'ready'].includes(status.state)) {
      clearInterval(watch);
      if (status.state === 'ready' && !screen) showUpdateCard();
    }
  }, 300);
  setTimeout(() => clearInterval(watch), 60_000);
}

// ── The updating screen ───────────────────────────────────────────

function openScreen({ manual = false } = {}) {
  if (screen) return screen;
  const root = el('div', 'upd');
  root.id = 'update-screen';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Updating Python by THETA172');

  const top = el('div', 'upd-top');
  const brand = el('div', 'upd-brand');
  brand.innerHTML = `${markSvg('th-mark th-mark--still upd-brand__mark')}<span>Python <small>by</small> THETA172</span>`; // static
  const lang = el('div', 'upd-lang');
  lang.setAttribute('role', 'group');
  lang.setAttribute('aria-label', 'Language');
  top.append(brand, lang);

  // The gauge: the THETA172 protractor; the needle and the red arc show the progress
  const gauge = el('div', 'upd-gauge th-dial');
  gauge.innerHTML = `${dialSvg()}<div class="th-markbox">${markSvg()}</div>`; // static
  gauge.setAttribute('role', 'progressbar');
  gauge.setAttribute('aria-valuemin', '0');
  gauge.setAttribute('aria-valuemax', '100');
  const readout = el('p', 'upd-readout');
  const pctEl = el('span', 'upd-readout__pct', '000%');
  const thetaEl = el('span', 'upd-readout__deg', 'θ = 000°');
  readout.append(pctEl, thetaEl);
  const eyebrow = el('p', 'upd-eyebrow', 'Update');
  const title = el('h1', 'upd-title');
  const sub = el('p', 'upd-sub');
  const steps = el('ol', 'upd-steps');
  const STEP_NAMES = [['download', 'Download'], ['prepare', 'Get ready'], ['restart', 'Restart']];
  for (const [id, label] of STEP_NAMES) { const li = el('li', 'upd-step', label); li.dataset.step = id; steps.append(li); }

  const tip = el('article', 'upd-tip');
  tip.setAttribute('aria-live', 'polite');
  const tipNav = el('div', 'upd-tip__nav');
  const dots = el('div', 'upd-tip__dots');
  const prev = btn('upd-tip__btn', '‹', () => showTip(index - 1, true));
  prev.setAttribute('aria-label', 'Previous card');
  const next = btn('upd-tip__btn', '›', () => showTip(index + 1, true));
  next.setAttribute('aria-label', 'Next card');
  tipNav.append(prev, dots, next);

  const foot = el('div', 'upd-foot');
  const later = btn('update-btn', 'Keep working', () => close());
  const installNow = btn('update-btn update-btn--primary', 'Restart and update', () => startUpdate());
  installNow.hidden = true;
  foot.append(later, installNow);

  const left = el('div', 'upd-left');
  left.append(gauge, readout);
  const words = el('div', 'upd-words');
  words.append(eyebrow, title, sub, steps);
  const main = el('div', 'upd-main');
  main.append(left, words);
  const side = el('div', 'upd-side');
  side.append(tip, tipNav);
  const body = el('div', 'upd-body');
  body.append(main, side);
  root.append(top, body, foot);
  document.body.append(root);
  const mark = gauge.querySelector('.th-mark');
  setTimeout(() => mark.classList.add('go'), reducedMotion() ? 0 : 350);
  setTimeout(() => root.classList.add('is-dial'), reducedMotion() ? 0 : 700);

  // Tips: start somewhere different each time
  const order = TIPS.map((_, i) => i).sort(() => Math.random() - 0.5);
  let index = 0;
  let tipTimer = null;
  const tipLang = () => (getExplainLang() === 'hi' ? 'hi' : 'en');
  const paintLang = () => {
    lang.replaceChildren();
    for (const [id, label] of [['en', 'English'], ['hi', 'हिंदी']]) {
      const b = btn(`upd-lang__btn${tipLang() === id ? ' is-on' : ''}`, label, () => { setExplainLang(id); paintLang(); showTip(index); });
      b.setAttribute('aria-pressed', String(tipLang() === id));
      lang.append(b);
    }
  };
  function showTip(i, byHand = false) {
    index = (i + order.length) % order.length;
    const t = TIPS[order[index]];
    const l = tipLang();
    const text = t[l] || t.en;
    tip.classList.remove('is-in');
    void tip.offsetWidth; // restart the entrance
    tip.replaceChildren(el('span', `upd-tip__kind is-${t.kind}`, KIND_LABEL[t.kind][l]), el('h2', 'upd-tip__title', text.t), el('p', 'upd-tip__body', text.b));
    if (t.code) tip.append(el('pre', 'upd-tip__code', t.code));
    tip.classList.add('is-in');
    dots.replaceChildren(...Array.from({ length: 7 }, (_, k) => el('i', k === index % 7 ? 'is-on' : '')));
    clearInterval(tipTimer);
    tipTimer = setInterval(() => showTip(index + 1), byHand ? TIP_MS * 1.5 : TIP_MS);
  }
  paintLang();
  showTip(0);

  // The needle follows the progress smoothly; while installing it keeps turning
  const needle = gauge.querySelector('.needle');
  const sweep = gauge.querySelector('.sweep');
  let target = 0;
  let theta = 0;
  let spinning = false;
  let raf = 0;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (spinning) theta = (theta + dt * 140) % 360;
    else theta += (target - theta) * (1 - Math.exp(-dt * 6));
    needle.setAttribute('transform', `rotate(${(-theta).toFixed(2)})`);
    sweep.setAttribute('d', spinning ? arcPath(359.9) : arcPath(theta));
    thetaEl.textContent = `θ = ${String(Math.round(theta) % 360).padStart(3, '0')}°`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const update = (s) => {
    const st = s.state;
    const version = s.version || status.version || '';
    later.hidden = st === 'installing' || (!manual && st !== 'error');
    later.textContent = 'Keep working';
    installNow.hidden = !(manual && st === 'ready');
    let step = 'download';
    let pct = 0;
    if (st === 'downloading') {
      pct = Math.max(1, Math.min(99, s.percent || 0));
      eyebrow.textContent = 'Downloading';
      title.textContent = `Version ${version}`;
      const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 10 ? 0 : 1);
      sub.textContent = s.total ? `${mb(s.transferred || 0)} of ${mb(s.total)} MB${s.bytesPerSecond ? ` · ${mb(s.bytesPerSecond)} MB/s` : ''}` : 'Starting the download…';
    } else if (st === 'ready') {
      step = 'prepare';
      pct = 100;
      eyebrow.textContent = 'Ready';
      title.textContent = `Version ${version} is ready`;
      sub.textContent = manual ? 'Restart now to finish, or keep working: it also installs when you close the app.' : 'Getting ready to restart…';
    } else if (st === 'installing') {
      step = 'restart';
      pct = 100;
      eyebrow.textContent = 'Updating';
      title.textContent = `Version ${version}`;
      sub.textContent = 'The app closes, installs the update and opens again by itself in about 10 seconds. Your files are saved.';
    } else if (st === 'error') {
      eyebrow.textContent = 'Stopped';
      title.textContent = 'The update did not finish';
      sub.textContent = s.message || 'It will try again later.';
      later.hidden = false;
      later.textContent = 'Close';
    }
    target = pct * 3.6;
    spinning = st === 'installing';
    pctEl.textContent = `${String(pct).padStart(3, '0')}%`;
    gauge.setAttribute('aria-valuenow', String(pct));
    root.classList.toggle('is-done', pct >= 100);
    const order2 = STEP_NAMES.map(([id]) => id);
    for (const li of steps.children) {
      const k = order2.indexOf(li.dataset.step);
      const cur = order2.indexOf(step);
      li.className = `upd-step${k < cur ? ' is-done' : k === cur ? ' is-now' : ''}`;
    }
  };

  const close = () => {
    clearInterval(tipTimer);
    cancelAnimationFrame(raf);
    root.classList.add('is-out');
    setTimeout(() => root.remove(), 250);
    screen = null;
    if (status.state === 'ready') { laterUntil = Date.now() + LATER_MS; scheduleAsk(); }
  };

  screen = { update, close };
  update(status);
  (installNow.hidden ? later : installNow).focus({ preventScroll: true });
  return screen;
}


// ── What's new (after an update) and About ───────────────────────

function modal(id, titleText, bodyNodes, buttons) {
  document.getElementById(id)?.remove();
  const overlay = el('div', 'upd-modal');
  overlay.id = id;
  const box = el('div', 'upd-modal__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', titleText);
  const head = el('div', 'upd-modal__head');
  const close = btn('upd-modal__close', '×', () => overlay.remove());
  close.setAttribute('aria-label', 'Close');
  head.append(el('h2', 'upd-modal__title', titleText), close);
  const foot = el('div', 'upd-modal__foot');
  foot.append(...buttons.map(([label, fn, primary]) => btn(`update-btn${primary ? ' update-btn--primary' : ''}`, label, () => { fn?.(); overlay.remove(); })));
  box.append(head, ...bodyNodes, foot);
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); overlay.remove(); } });
  document.body.append(overlay);
  close.focus({ preventScroll: true });
}

export function showWhatsNew(w = info?.whatsNew) {
  const lines = (w?.notes || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/\[critical\]/i, '').trim());
  const list = el('ul', 'upd-modal__notes');
  for (const l of lines.length ? lines : ['Improvements and fixes.']) list.append(el('li', '', l.replace(/^[•*-]\s*/, '')));
  modal('whats-new', `What's new in ${w?.version || info?.version || 'this version'}`, [el('p', 'upd-modal__lead', 'You are now on the latest version.'), list], [['Great', null, true]]);
}

export function showAbout() {
  const v = info?.version || '';
  const rows = el('dl', 'upd-about');
  const row = (k, val) => rows.append(el('dt', '', k), el('dd', '', val));
  row('Version', v || 'unknown');
  row('Updates', !info?.enabled ? (info?.policy === 'off' ? 'Managed by your school' : 'Only in the installed app')
    : info?.policy === 'manual' ? 'You check (school setting)' : info?.auto ? 'Automatic' : 'You check (your setting)');
  if (info?.updatedFrom) row('Updated from', info.updatedFrom);
  const lead = el('p', 'upd-modal__lead', 'A Python IDE for students, teachers and professionals: learn with explanations in English and हिंदी, teach live classes on any network, and work with notebooks, a debugger and tests.');
  modal('about-theta', 'Python by THETA172', [lead, rows], [['Check for updates', () => checkForUpdates(), true], ['Close', null, false]]);
}

// ── Settings: Automatic updates ───────────────────────────────────

function wireSettings() {
  const sw = document.getElementById('set-updates');
  const hint = document.getElementById('set-updates-hint');
  if (!sw) return;
  const paint = () => sw.setAttribute('aria-checked', String(!!info.auto && info.policy === 'auto'));
  paint();
  if (info.policy !== 'auto') {
    sw.disabled = true;
    if (hint) hint.textContent = info.policy === 'off' ? 'Your school manages updates on this computer.' : 'Your school set updates to "check by hand": use Help → Check for updates.';
    return;
  }
  sw.addEventListener('click', async () => {
    const on = sw.getAttribute('aria-checked') !== 'true';
    info.auto = on;
    paint();
    await api()?.updateSetAuto?.(on);
  });
}

/** Test hook (smoke and screenshot tours): pretend the main process sent this. */
export function _simulateStatus(s, extra = {}) {
  if (!info) info = { version: '1.0.0', auto: true, policy: 'auto', enabled: true };
  Object.assign(info, extra);
  onStatus(s);
}
export const _openUpdateScreen = (opts) => openScreen(opts);
export const _closeUpdateScreen = () => screen?.close();

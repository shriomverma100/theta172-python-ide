/**
 * Learning helpers around Run, for every student (in a class or not):
 *   - errors explained in English or Hindi under the output;
 *   - predict-then-run: write what you expect, run, compare;
 *   - My progress: the mastery map from real runs, exportable as a report.
 */
import { explainError, uiText, LANGS } from './explain/errors.js';
import { detectConcepts, conceptLabel, CONCEPTS } from './concepts.js';
import { loadMastery, recordRun, levelOf, summarize, reportHtml, LEVELS } from './mastery.js';
import { comparePrediction } from './predict.js';
import { storageGet, storageSet } from '../core/storage.js';
import { showToast } from '../toast.js';

const LANG_KEY = 'theta-explain-lang';
const MASTERY_KEY = 'theta-mastery-v1';

let lang = 'en';
let mastery = null;
let lastError = null;     // { type, message, line, lineText, code }
let prediction = null;    // text the student expects (armed for the next run)
let runCodeFn = null;
const changeListeners = new Set();

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export const getExplainLang = () => lang;
export const getLastError = () => lastError;
export const getMasterySummary = () => summarize(mastery);
/** fn(event) after each recorded run: { concepts, ok, error, predictedRight, summary } */
export function onLearnRun(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }

export function setExplainLang(id) {
  lang = LANGS.some((l) => l.id === id) ? id : 'en';
  storageSet(LANG_KEY, lang);
  if (lastError && !document.getElementById('explain-card')?.classList.contains('hidden')) showExplanation(lastError);
}

// ── Explanation card ───────────────────────────────────────────────

function card() {
  let c = document.getElementById('explain-card');
  if (!c) {
    c = el('section', 'explain-card hidden');
    c.id = 'explain-card';
    c.setAttribute('role', 'region');
    c.setAttribute('aria-live', 'polite');
    const well = document.querySelector('.terminal-well');
    well?.parentElement?.insertBefore(c, well);
  }
  return c;
}

export function hideExplanation() { card().classList.add('hidden'); }

/**
 * Show an error explained in the chosen language.
 * @param {{ type, message, line, lineText, code }} error
 * @param {{ fromTeacher?: boolean }} [opts]
 */
export function showExplanation(error, { fromTeacher = false } = {}) {
  const ex = explainError(error, { lang, code: error.code || '' });
  if (!ex) return;
  const t = uiText(lang);
  const c = card();
  c.replaceChildren();
  c.classList.remove('hidden', 'explain-card--predict');
  c.lang = lang === 'hi' ? 'hi' : 'en';

  const head = el('div', 'explain-card__head');
  const kicker = el('span', 'explain-card__kicker', fromTeacher ? t.fromTeacher : t.heading);
  head.append(kicker);
  if (ex.line) head.append(el('span', 'explain-card__line', t.line.replace('{line}', ex.line)));
  head.append(el('span', 'explain-card__fill'));
  const langs = el('div', 'explain-card__langs');
  langs.setAttribute('role', 'group');
  langs.setAttribute('aria-label', t.explainIn);
  for (const l of LANGS) {
    const b = el('button', 'explain-card__lang', l.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(l.id === lang));
    b.addEventListener('click', () => setExplainLang(l.id));
    langs.append(b);
  }
  const close = el('button', 'explain-card__close', '×');
  close.type = 'button';
  close.title = t.hide;
  close.setAttribute('aria-label', t.hide);
  close.addEventListener('click', hideExplanation);
  head.append(langs, close);

  const title = el('div', 'explain-card__title', ex.title);
  c.append(head, title);
  if (ex.hint) c.append(el('div', 'explain-card__hint', ex.hint));
  if (ex.lineText) {
    const code = el('code', 'explain-card__code', ex.lineText);
    c.append(code);
  }
  const body = el('div', 'explain-card__body');
  if (ex.why) {
    const p = el('p', 'explain-card__p');
    p.append(el('b', '', `${t.why}: `), document.createTextNode(ex.why));
    body.append(p);
  }
  if (ex.fix) {
    const p = el('p', 'explain-card__p explain-card__p--fix');
    p.append(el('b', '', `${t.fix}: `), document.createTextNode(ex.fix));
    body.append(p);
  }
  c.append(body);
  if (ex.message) c.append(el('div', 'explain-card__orig', `${t.showOriginal}: ${ex.type}: ${ex.message}`));
}

// ── Predict then run ───────────────────────────────────────────────

function predictPopover(anchor) {
  document.getElementById('predict-pop')?.remove();
  const pop = el('div', 'predict-pop');
  pop.id = 'predict-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Predict the output');
  const hi = lang === 'hi';
  pop.append(
    el('div', 'predict-pop__title', hi ? 'पहले अनुमान लगाएँ' : 'Predict first'),
    el('div', 'predict-pop__lead', hi ? 'आपको क्या लगता है, यह प्रोग्राम क्या print करेगा?' : 'What do you think this program will print?'),
  );
  const box = el('textarea', 'predict-pop__box');
  box.rows = 5;
  box.spellcheck = false;
  box.placeholder = hi ? 'हर लाइन अलग लिखें' : 'One line per printed line';
  box.value = prediction || '';
  const row = el('div', 'predict-pop__row');
  const cancel = el('button', 'predict-pop__btn', hi ? 'रद्द करें' : 'Cancel');
  cancel.type = 'button';
  const go = el('button', 'predict-pop__btn predict-pop__btn--go', hi ? 'चलाएँ और मिलाएँ' : 'Run and compare');
  go.type = 'button';
  row.append(cancel, go);
  pop.append(box, row);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = 340;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  pop.style.top = r.top > window.innerHeight / 2 ? `${Math.max(8, r.top - pop.offsetHeight - 8)}px` : `${r.bottom + 8}px`;
  const closeIt = () => { pop.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closeIt(); };
  document.addEventListener('mousedown', outside, true);
  cancel.addEventListener('click', () => { prediction = null; updatePredictButtons(); closeIt(); });
  const submit = () => {
    prediction = box.value;
    updatePredictButtons();
    closeIt();
    runCodeFn?.();
  };
  go.addEventListener('click', submit);
  box.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing here must not trigger editor shortcuts
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') closeIt();
  });
  setTimeout(() => box.focus(), 0);
}

function updatePredictButtons() {
  document.querySelectorAll('[data-predict-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(prediction !== null));
  });
}

function showPredictionResult(result) {
  const hi = lang === 'hi';
  const c = card();
  c.replaceChildren();
  c.classList.remove('hidden');
  c.classList.add('explain-card--predict');
  const head = el('div', 'explain-card__head');
  head.append(el('span', 'explain-card__kicker', hi ? 'आपका अनुमान' : 'Your prediction'), el('span', 'explain-card__fill'));
  const close = el('button', 'explain-card__close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Hide');
  close.addEventListener('click', hideExplanation);
  head.append(close);
  const verdict = result.right
    ? (hi ? 'बिल्कुल सही! आपने सही अनुमान लगाया।' : 'Spot on! Your prediction was right.')
    : (hi ? `${Math.round(result.score * 100)}% लाइनें सही — अंतर नीचे देखें।` : `${Math.round(result.score * 100)}% of lines right — see the differences below.`);
  c.append(head, el('div', `explain-card__title ${result.right ? 'is-right' : 'is-wrong'}`, verdict));
  if (!result.exact) {
    const table = el('div', 'predict-diff');
    table.append(el('span', 'predict-diff__h', hi ? 'आपका अनुमान' : 'You predicted'), el('span', 'predict-diff__h', hi ? 'असल आउटपुट' : 'It printed'));
    for (const row of result.rows.slice(0, 40)) {
      table.append(el('code', `predict-diff__c is-${row.status}`, row.expected || ' '), el('code', `predict-diff__c is-${row.status}`, row.actual || ' '));
    }
    c.append(table);
  }
}

// ── My progress ────────────────────────────────────────────────────

function saveMastery() { storageSet(MASTERY_KEY, JSON.stringify(mastery)); }

export function openProgress() {
  document.getElementById('progress-modal')?.remove();
  const hi = lang === 'hi';
  const overlay = el('div', 'progress-modal');
  overlay.id = 'progress-modal';
  const box = el('div', 'progress-modal__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', hi ? 'मेरी प्रगति' : 'My progress');
  const head = el('div', 'progress-modal__head');
  head.append(el('h2', 'progress-modal__title', hi ? 'मेरी प्रगति' : 'My progress'));
  const langBtn = el('button', 'progress-modal__btn', hi ? 'English' : 'हिंदी');
  langBtn.type = 'button';
  langBtn.addEventListener('click', () => { setExplainLang(hi ? 'en' : 'hi'); openProgress(); });
  const exportBtn = el('button', 'progress-modal__btn progress-modal__btn--primary', hi ? 'रिपोर्ट सेव करें' : 'Save report');
  exportBtn.type = 'button';
  exportBtn.addEventListener('click', exportReport);
  const close = el('button', 'progress-modal__close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  head.append(langBtn, exportBtn, close);

  const s = summarize(mastery);
  const stats = el('div', 'progress-modal__stats');
  const stat = (n, label) => { const d = el('div', 'progress-stat'); d.append(el('b', '', String(n)), el('span', '', label)); return d; };
  stats.append(
    stat(mastery.runs, hi ? 'रन' : 'runs'),
    stat(mastery.okRuns, hi ? 'सफल' : 'worked'),
    stat(s.fixed.length, hi ? 'त्रुटियाँ ठीक कीं' : 'error kinds fixed'),
    stat(mastery.predictions.tried ? `${mastery.predictions.right}/${mastery.predictions.tried}` : '—', hi ? 'सही अनुमान' : 'predictions right'),
  );
  const list = el('div', 'progress-modal__list');
  for (const { id } of CONCEPTS) {
    const c = mastery.concepts[id];
    const l = levelOf(c);
    const row = el('div', `progress-row level-${l}`);
    const bar = el('span', 'progress-row__bar');
    const fill = el('span', 'progress-row__fill');
    fill.style.width = `${l * 25}%`;
    bar.append(fill);
    row.append(el('span', 'progress-row__name', conceptLabel(id, lang)), bar, el('span', 'progress-row__level', LEVELS[l][lang] || LEVELS[l].en));
    row.title = c ? `${c.ok} / ${c.runs}` : '';
    list.append(row);
  }
  const note = el('p', 'progress-modal__note', hi
    ? 'यह नक्शा आपके अपने चलाए गए कोड से बनता है: हर रन उन विषयों में गिना जाता है जो उसके कोड में हैं।'
    : 'Built from the code you actually run: every run counts towards the topics its code uses.');
  box.append(head, stats, list, note);
  overlay.append(box);
  document.body.append(overlay);
  const closeIt = () => overlay.remove();
  close.addEventListener('click', closeIt);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeIt(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeIt(); } });
  close.focus();
}

async function exportReport() {
  const name = storageGet('theta-classroom-student-name') || '';
  const html = reportHtml(mastery, { name, lang });
  const api = window.electronAPI;
  if (api?.saveFileAs) {
    const res = await api.saveFileAs(html, 'progress-report.html');
    if (res?.error) showToast(`Save failed: ${res.error}`, 'error', 3000);
    else if (res) showToast(lang === 'hi' ? 'रिपोर्ट सेव हो गई' : 'Report saved', 'save', 2000);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = 'progress-report.html';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Wiring ─────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {Function} deps.onRunFinish  runtime's run-finished hook
 * @param {Function} deps.onRunStart
 * @param {Function} deps.runCode
 */
export function initLearn({ onRunFinish, onRunStart, runCode }) {
  lang = storageGet(LANG_KEY) === 'hi' ? 'hi' : 'en';
  mastery = loadMastery(storageGet(MASTERY_KEY) || '');
  runCodeFn = runCode;

  onRunStart(() => hideExplanation());
  onRunFinish((run) => {
    if (run.stopped) { prediction = null; updatePredictButtons(); return; }
    const concepts = detectConcepts(run.code);
    let predictedRight;
    if (prediction !== null) {
      const result = comparePrediction(prediction, run.stdout);
      predictedRight = result.right;
      prediction = null;
      updatePredictButtons();
      if (run.ok) showPredictionResult(result);
    }
    if (run.ok) lastError = null;
    else {
      lastError = { ...run.error, code: run.code };
      if (run.error.type !== 'KeyboardInterrupt') showExplanation(lastError);
    }
    recordRun(mastery, { concepts, ok: run.ok, errorType: run.ok ? undefined : run.error.type, predictedRight });
    saveMastery();
    const event = { concepts, ok: run.ok, error: run.ok ? null : run.error, predictedRight, summary: summarize(mastery) };
    changeListeners.forEach((fn) => { try { fn(event); } catch (err) { console.error('[learn]', err); } });
  });

  // Predict buttons (top bar in Pro, run rail in Playground)
  document.querySelectorAll('[data-predict-btn]').forEach((b) => b.addEventListener('click', () => predictPopover(b)));
  document.getElementById('btn-progress')?.addEventListener('click', openProgress);
}

/** Predict popover from the command palette. */
export function startPrediction() {
  const anchor = [...document.querySelectorAll('[data-predict-btn]')].find((b) => b.offsetParent) || document.getElementById('btn-run');
  if (anchor) predictPopover(anchor);
}

/**
 * The mastery map: what a student can do, built from their real runs.
 *
 * Every run adds to the concepts its code uses: a run that works counts
 * for them, one that fails counts against. Errors are remembered by kind,
 * and an error kind counts as "fixed" when a failing run is followed by a
 * working one. Predictions (predict-then-run) count separately. Pure
 * functions on a plain object, saved by the caller (localStorage).
 */
import { CONCEPTS, conceptLabel } from './concepts.js';

export const LEVELS = [
  { en: 'Not yet', hi: 'अभी नहीं' },
  { en: 'Trying', hi: 'कोशिश जारी' },
  { en: 'Getting there', hi: 'आगे बढ़ रहे हैं' },
  { en: 'Confident', hi: 'आत्मविश्वासी' },
  { en: 'Mastered', hi: 'महारत' },
];

export function emptyMastery() {
  return { v: 1, concepts: {}, errors: {}, failing: [], predictions: { tried: 0, right: 0 }, runs: 0, okRuns: 0, since: null };
}

/** A saved map, checked (anything odd starts fresh). */
export function loadMastery(json) {
  try {
    const m = JSON.parse(json);
    if (m && m.v === 1 && typeof m.concepts === 'object' && typeof m.errors === 'object') return { ...emptyMastery(), ...m };
  } catch (_) { /* fall through */ }
  return emptyMastery();
}

/**
 * Add a run.
 * @param {object} m          the map (changed in place and returned)
 * @param {object} run
 * @param {string[]} run.concepts
 * @param {boolean} run.ok
 * @param {string} [run.errorType]
 * @param {boolean} [run.predictedRight]  undefined when the student did not predict
 * @param {number} [run.now]
 */
export function recordRun(m, { concepts = [], ok, errorType, predictedRight, now = Date.now() }) {
  m.runs++;
  if (ok) m.okRuns++;
  if (!m.since) m.since = now;
  for (const id of concepts) {
    const c = (m.concepts[id] ||= { runs: 0, ok: 0, fail: 0, last: 0 });
    c.runs++;
    if (ok) c.ok++;
    else c.fail++;
    c.last = now;
  }
  if (ok) {
    // The errors of the failing streak count as fixed
    for (const type of m.failing) {
      const e = (m.errors[type] ||= { seen: 0, fixed: 0, last: 0 });
      e.fixed++;
      e.lastFixed = now;
    }
    m.failing = [];
  } else if (errorType) {
    const e = (m.errors[errorType] ||= { seen: 0, fixed: 0, last: 0 });
    e.seen++;
    e.last = now;
    if (!m.failing.includes(errorType)) m.failing.push(errorType);
  }
  if (predictedRight !== undefined) {
    m.predictions.tried++;
    if (predictedRight) m.predictions.right++;
  }
  return m;
}

/** 0 not yet · 1 trying · 2 getting there · 3 confident · 4 mastered */
export function levelOf(c) {
  if (!c || !c.runs) return 0;
  if (!c.ok) return 1;
  const rate = c.ok / c.runs;
  if (c.ok >= 8 && rate >= 0.7) return 4;
  if (c.ok >= 4 && rate >= 0.5) return 3;
  return 2;
}

/** Small summary for the teacher: { concepts: { id: level }, fixed: [types], predictions }. */
export function summarize(m) {
  const concepts = {};
  for (const { id } of CONCEPTS) {
    const l = levelOf(m.concepts[id]);
    if (l) concepts[id] = l;
  }
  const fixed = Object.entries(m.errors).filter(([, e]) => e.fixed > 0).map(([t]) => t);
  return { concepts, fixed, predictions: { ...m.predictions }, runs: m.runs, okRuns: m.okRuns };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * A printable progress report (for parents and principals): standalone HTML.
 * @param {object} m
 * @param {{ name?: string, lang?: 'en'|'hi', date?: Date }} [opts]
 */
export function reportHtml(m, { name = '', lang = 'en', date = new Date() } = {}) {
  const T = lang === 'hi'
    ? { title: 'प्रगति रिपोर्ट', runs: 'कुल रन', worked: 'सफल', predicted: 'सही अनुमान', concept: 'विषय', level: 'स्तर', errors: 'ठीक की गई त्रुटियाँ', none: 'अभी कोई नहीं', note: 'यह रिपोर्ट छात्र के अपने चलाए गए कोड से बनी है, किसी परीक्षा से नहीं।' }
    : { title: 'Progress report', runs: 'Runs', worked: 'Worked', predicted: 'Predictions right', concept: 'Topic', level: 'Level', errors: 'Errors fixed', none: 'None yet', note: 'Built from the code this student actually wrote and ran, not from a quiz.' };
  const rows = CONCEPTS.map(({ id }) => {
    const l = levelOf(m.concepts[id]);
    return `<tr><td>${esc(conceptLabel(id, lang))}</td><td><span class="bar"><span style="width:${l * 25}%"></span></span> ${esc(LEVELS[l][lang] || LEVELS[l].en)}</td></tr>`;
  }).join('');
  const fixed = Object.entries(m.errors).filter(([, e]) => e.fixed > 0).sort((a, b) => b[1].fixed - a[1].fixed)
    .map(([t, e]) => `<li>${esc(t)} × ${e.fixed}</li>`).join('');
  const p = m.predictions.tried ? `${m.predictions.right} / ${m.predictions.tried}` : '—';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(T.title)}${name ? ` · ${esc(name)}` : ''}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#17142E;max-width:720px;margin:32px auto;padding:0 16px}h1{font-size:22px;margin:0}
.meta{color:#555;margin:4px 0 20px}.stats{display:flex;gap:24px;margin:0 0 20px}.stats b{display:block;font-size:22px}
table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}
.bar{display:inline-block;width:120px;height:8px;background:#eee;border-radius:4px;vertical-align:middle;margin-right:8px;overflow:hidden}
.bar span{display:block;height:100%;background:#FF4A36}.note{color:#666;font-size:12px;margin-top:24px}</style></head><body>
<h1>${esc(T.title)}</h1><div class="meta">${esc(name)}${name ? ' · ' : ''}${esc(date.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN'))} · Python by THETA172</div>
<div class="stats"><div><b>${m.runs}</b>${esc(T.runs)}</div><div><b>${m.okRuns}</b>${esc(T.worked)}</div><div><b>${esc(p)}</b>${esc(T.predicted)}</div></div>
<table><thead><tr><th>${esc(T.concept)}</th><th>${esc(T.level)}</th></tr></thead><tbody>${rows}</tbody></table>
<h2 style="font-size:16px;margin-top:20px">${esc(T.errors)}</h2>${fixed ? `<ul>${fixed}</ul>` : `<p>${esc(T.none)}</p>`}
<p class="note">${esc(T.note)}</p></body></html>`;
}

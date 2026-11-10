/**
 * Viva Mode and authorship replay, in the app.
 *  - Every code tab keeps an authorship record (typed / pasted / AI / teacher).
 *  - openViva(): a few questions about the student's own code; the answers
 *    go to the teacher with the code and its record (or stay private when
 *    practising).
 *  - openReplay(): watch a file being written, coloured by who wrote what,
 *    next to the viva answers.
 */
import { onContentChange, isMirrorEdit, isLoadEdit, editOrigin } from '../editor.js';
import { visibleTabs, onTabsChanged, getTabs } from '../app/tabs.js';
import { Authorship, replayAt, describeStats, KINDS } from './authorship.js';
import { vivaQuestions } from './viva.js';
import { getExplainLang } from './learn-ui.js';

const records = new Map(); // tab id -> Authorship

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (cls, text, onClick) => {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

// ── Recording ──────────────────────────────────────────────────────

export function initAuthorship() {
  onContentChange((update) => {
    const shown = visibleTabs().find((v) => v.view === update.view);
    const tab = shown?.tab;
    if (!tab || tab.kind === 'notebook' || tab.libraryUri) return;
    let rec = records.get(tab.id);
    for (const tr of update.transactions) {
      if (!tr.docChanged || isMirrorEdit(tr)) continue;
      if (!rec) {
        rec = new Authorship(tr.startState.doc.toString());
        records.set(tab.id, rec);
      }
      const kind = isLoadEdit(tr) ? 'l'
        : tr.annotation(editOrigin) || (tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop') ? 'p' : 't');
      const changes = [];
      tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => changes.push({ at: fromB, del: toA - fromA, ins: inserted.toString() }));
      rec.record(changes, kind);
    }
  });
  // Forget tabs that were closed
  onTabsChanged(() => {
    const live = new Set(getTabs().map((t) => t.id));
    for (const id of records.keys()) if (!live.has(id)) records.delete(id);
  });
}

/** The record of a tab, as plain data (an empty one when nothing was edited yet). */
export function recordingFor(tabId, currentText = '') {
  const rec = records.get(tabId);
  return rec ? rec.toJSON() : new Authorship(currentText).toJSON();
}

// ── Viva ───────────────────────────────────────────────────────────

function modal(label, cls = '') {
  const overlay = el('div', `viva-modal ${cls}`);
  const box = el('div', 'viva-modal__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', label);
  overlay.append(box);
  document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing answers must not trigger app shortcuts
    if (e.key === 'Escape') close();
  });
  return { overlay, box, close };
}

/**
 * Ask the viva questions.
 * @param {object} opts
 * @param {string} opts.code
 * @param {string} opts.fileName
 * @param {'class'|'practice'} [opts.mode]
 * @returns {Promise<null | { questions: object[], answers: string[] }>}  null when cancelled
 */
export function openViva({ code, fileName, mode = 'class' }) {
  const hi = getExplainLang() === 'hi';
  const questions = vivaQuestions(code);
  return new Promise((resolve) => {
    const { box, close } = modal(hi ? 'वाइवा' : 'Viva');
    const finish = (value) => { close(); resolve(value); };
    const head = el('div', 'viva-modal__head');
    head.append(
      el('h2', 'viva-modal__title', hi ? 'वाइवा: आपके कोड के बारे में कुछ सवाल' : 'Viva: a few questions about your code'),
      button('viva-modal__close', '×', () => finish(null)),
    );
    const lead = el('p', 'viva-modal__lead', mode === 'class'
      ? (hi ? `जमा करने से पहले ${fileName} के बारे में अपने शब्दों में उत्तर दें। आपके शिक्षक आपके उत्तर आपके कोड के साथ देखेंगे।` : `Before you hand in ${fileName}, answer in your own words. Your teacher sees your answers next to your code.`)
      : (hi ? 'अभ्यास: ये उत्तर केवल आपके लिए हैं।' : 'Practice: these answers are just for you.'));
    box.append(head, lead);
    if (!questions.length) box.append(el('p', 'viva-modal__lead', hi ? 'पूछने के लिए कोड नहीं मिला।' : 'There is no code to ask about yet.'));
    const boxes = questions.map((q, i) => {
      const card = el('div', 'viva-q');
      const top = el('div', 'viva-q__top');
      top.append(el('span', 'viva-q__n', String(i + 1)), el('span', 'viva-q__text', hi ? q.hi : q.en));
      card.append(top);
      if (q.lineText) {
        const code = el('code', 'viva-q__code');
        code.append(el('span', 'viva-q__ln', String(q.line)), document.createTextNode(q.lineText));
        card.append(code);
      }
      const ta = el('textarea', 'viva-q__answer');
      ta.rows = 3;
      ta.placeholder = hi ? 'आपका उत्तर' : 'Your answer';
      ta.setAttribute('aria-label', `${hi ? 'उत्तर' : 'Answer'} ${i + 1}`);
      card.append(ta);
      box.append(card);
      return ta;
    });
    const row = el('div', 'viva-modal__row');
    const note = el('span', 'viva-modal__note', '');
    const submit = button('viva-modal__btn viva-modal__btn--primary', mode === 'class' ? (hi ? 'जमा करें' : 'Hand in') : (hi ? 'हो गया' : 'Done'), () => {
      const answers = boxes.map((b) => b.value.trim());
      if (mode === 'class' && answers.some((a) => a.length < 2)) {
        note.textContent = hi ? 'कृपया हर सवाल का उत्तर दें।' : 'Please answer every question.';
        boxes.find((b) => b.value.trim().length < 2)?.focus();
        return;
      }
      finish({ questions, answers });
    });
    row.append(note, button('viva-modal__btn', hi ? 'रद्द करें' : 'Cancel', () => finish(null)), submit);
    box.append(row);
    setTimeout(() => (boxes[0] || submit).focus(), 0);
  });
}

// ── Replay ─────────────────────────────────────────────────────────

const KIND_CLASS = { t: 'typed', p: 'pasted', a: 'ai', r: 'teacher', l: 'loaded' };

function paint(pre, text, spans) {
  pre.replaceChildren();
  let at = 0;
  for (const s of spans) {
    const part = text.slice(at, at + s.len);
    at += s.len;
    if (!part) continue;
    if (s.k === 't') pre.append(document.createTextNode(part));
    else pre.append(el('span', `replay-k replay-k--${KIND_CLASS[s.k]}`, part));
  }
  if (at < text.length) pre.append(document.createTextNode(text.slice(at)));
}

const clock = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Watch how a file was written.
 * @param {object} opts
 * @param {string} opts.title
 * @param {object|null} opts.recording   from recordingFor() (may be missing for big files)
 * @param {string} opts.code             the final code (shown when there is no recording)
 * @param {{ en: string, hi?: string, line?: number }[]} [opts.questions]
 * @param {string[]} [opts.answers]
 */
export function openReplay({ title, recording, code = '', questions = [], answers = [] }) {
  const { box } = modal(title, 'viva-modal--wide');
  const head = el('div', 'viva-modal__head');
  head.append(el('h2', 'viva-modal__title', title), button('viva-modal__close', '×', () => box.parentElement.remove()));
  box.append(head);

  const body = el('div', 'replay');
  const left = el('div', 'replay__main');
  const stats = recording?.stats;
  // Who wrote it: a bar and a legend
  if (stats?.total) {
    const bar = el('div', 'replay__bar');
    const legend = el('div', 'replay__legend');
    for (const k of ['t', 'p', 'a', 'r', 'l']) {
      if (!stats[k]) continue;
      const seg = el('span', `replay__seg replay-k--${KIND_CLASS[k]}`);
      seg.style.flexGrow = String(stats[k]);
      bar.append(seg);
      const key = el('span', `replay__key replay-k--${KIND_CLASS[k]}`);
      key.textContent = `${KINDS[k]} ${Math.round((100 * stats[k]) / stats.total)}%`;
      legend.append(key);
    }
    left.append(bar, legend);
  }
  const pre = el('pre', 'replay__code');
  left.append(pre);

  const events = recording?.events || [];
  if (recording && events.length) {
    const controls = el('div', 'replay__controls');
    const play = button('viva-modal__btn replay__play', 'Play', () => toggle());
    const slider = el('input', 'replay__slider');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(events.length);
    slider.value = String(events.length);
    slider.setAttribute('aria-label', 'Position in the recording');
    const time = el('span', 'replay__time');
    const speed = el('select', 'replay__speed');
    for (const v of [1, 4, 16, 64]) {
      const o = el('option', '', `${v}×`);
      o.value = String(v);
      if (v === 16) o.selected = true;
      speed.append(o);
    }
    speed.setAttribute('aria-label', 'Speed');
    controls.append(play, slider, time, speed);
    left.append(controls);
    if (recording.truncated) left.append(el('p', 'replay__note', 'This file was edited a lot: the replay stops at the 20 000th change (the totals are complete).'));

    let n = events.length;
    let timer = null;
    const total = events[events.length - 1].t;
    const show = () => {
      const st = replayAt(recording, n);
      paint(pre, st.text, st.spans);
      slider.value = String(n);
      time.textContent = `${clock(st.t)} / ${clock(total)} · change ${n} of ${events.length}`;
    };
    const stop = () => { clearInterval(timer); timer = null; play.textContent = 'Play'; };
    const toggle = () => {
      if (timer) { stop(); return; }
      if (n >= events.length) n = 0;
      play.textContent = 'Pause';
      // Real time between edits, sped up; long pauses are shortened
      let last = performance.now();
      let clockMs = n ? events[n - 1].t : 0;
      timer = setInterval(() => {
        const now = performance.now();
        clockMs += (now - last) * Number(speed.value);
        last = now;
        // A long pause in the writing is skipped (one second of it is kept)
        if (n < events.length && events[n].t - clockMs > 3000) clockMs = events[n].t - 1000;
        while (n < events.length && events[n].t <= clockMs) n++;
        show();
        if (n >= events.length) stop();
      }, 50);
    };
    slider.addEventListener('input', () => { stop(); n = Number(slider.value); show(); });
    new MutationObserver((_, obs) => { if (!box.isConnected) { stop(); obs.disconnect(); } }).observe(document.body, { childList: true });
    show();
  } else {
    pre.textContent = code;
    left.append(el('p', 'replay__note', recording ? 'No edits were recorded for this file.' : 'This file was too large to send its edit history.'));
  }
  if (stats?.total) left.append(el('p', 'replay__note', `Who wrote the final file: ${describeStats(stats)}.`));
  body.append(left);

  if (questions.length) {
    const side = el('div', 'replay__viva');
    side.append(el('div', 'replay__viva-title', 'Viva answers'));
    questions.forEach((q, i) => {
      const item = el('div', 'replay__qa');
      item.append(el('div', 'replay__q', `${i + 1}. ${q.en}`), el('div', 'replay__a', answers[i] || '—'));
      side.append(item);
    });
    body.append(side);
  }
  box.append(body);
}

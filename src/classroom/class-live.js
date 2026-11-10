/**
 * Phase 10 in the classroom: what the teacher sees and does live, and what
 * each student's app sends and shows.
 *
 * Teacher: the join code and routes, the class pulse (finished / working /
 * stuck), the most common bug right now ("Explain to everyone" shows it to
 * each student in their own language), the hands-up queue with a suggested
 * classmate who just fixed the same error, and heat marks on the teacher's
 * own code where students are stuck.
 * Student: run results and progress go to the teacher, explanations and
 * help requests come back, "I'm done", and a calm "reconnecting" state.
 */
import { createPulse, applyEvent, studentState, summary, commonBug, suggestHelpers, lineHeat, setOnline, removeStudent } from './pulse.js';
import { explainError } from '../learn/explain/errors.js';
import { conceptLabel } from '../learn/concepts.js';
import { onLearnRun, showExplanation, getLastError, getExplainLang, getMasterySummary } from '../learn/learn-ui.js';
import { setClassHeat } from '../editor.js';
import { openViva, openReplay, recordingFor } from '../learn/viva-ui.js';
import { initClassShare, shareStarted, shareStopped, handleShareEvent, shareLeft } from './class-share.js';
import { validRecording, describeStats } from '../learn/authorship.js';
import { showToast } from '../toast.js';

const api = () => window.electronAPI;
const RELAY_KEY = 'theta-relay-url';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (cls, text, onClick, title) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};

export function getRelayUrl() {
  try { return localStorage.getItem(RELAY_KEY) || ''; } catch (_) { return ''; }
}
export function setRelayUrl(url) {
  try { localStorage.setItem(RELAY_KEY, String(url || '').trim()); } catch (_) { /* private mode */ }
}

// ══════════════════════════════════════════════════════════════════
// TEACHER
// ══════════════════════════════════════════════════════════════════

const pulse = createPulse();
const hands = new Map();  // student id -> { name, message, error, at, routedTo }
const routes = new Map(); // helper id -> helped id
const names = new Map();  // id -> name
let teacherOn = false;
let pulseTimer = null;
let getTeacherCode = () => '';
let getStudentCode = () => '';
let getCurrentFile = () => ({ tabId: null, code: '', fileName: 'main.py' });
const submissions = new Map(); // student id -> latest hand-in
let onStudentsChanged = () => {};
let relay = { state: 'off', code: null };
let lan = false;

/**
 * @param {object} deps
 * @param {() => string} deps.teacherCode     the code the teacher is showing
 * @param {(id: string) => string} deps.studentCode  a student's latest code
 * @param {() => void} deps.studentsChanged   re-render the student list (states changed)
 */
export function initClassLive({ teacherCode, studentCode, studentsChanged, currentFile }) {
  getTeacherCode = teacherCode;
  getStudentCode = studentCode;
  if (currentFile) getCurrentFile = currentFile;
  onStudentsChanged = studentsChanged;
  const a = api();
  if (!a) return;
  a.onStudentEvent?.((who, msg) => teacherEvent(who, msg));
  a.onStudentStatus?.((info) => {
    setOnline(pulse, info.id, info.state === 'online');
    names.set(info.id, info.name);
    onStudentsChanged();
    renderPulse();
  });
  a.onRelayStatus?.((info) => { relay = info; renderRoutes(); });
  // Student side
  a.onLinkStatus?.((info) => renderLinkStatus(info));
  a.onJoinError?.((message) => {
    showToast(message, 'error', 4000);
    const t = document.getElementById('cr-discovery-text');
    if (t) t.textContent = `${message} Check the code with your teacher.`;
  });
  a.onClassEvent?.((msg) => studentEvent(msg));
  initClassShare();
  onLearnRun((run) => studentRan(run));
}

export function teacherStarted(result) {
  teacherOn = true;
  shareStarted();
  lan = !!result?.lan;
  renderRoutes();
  renderPulse();
  clearInterval(pulseTimer);
  pulseTimer = setInterval(() => { renderPulse(); updateHeat(); }, 4000);
}

export function teacherStopped() {
  teacherOn = false;
  shareStopped();
  clearInterval(pulseTimer);
  pulse.students.clear();
  hands.clear();
  routes.clear();
  submissions.clear();
  setClassHeat(null);
  relay = { state: 'off', code: null };
}

export function noteJoin(info) {
  names.set(info.id, info.name);
  applyEvent(pulse, info.id, info.name, { type: 'typing' });
  renderPulse();
}

export function noteLeave(id) {
  removeStudent(pulse, id);
  hands.delete(id);
  routes.delete(id);
  renderPulse();
}

export function noteActivity(id) {
  if (pulse.students.has(id)) applyEvent(pulse, id, '', { type: 'typing' });
}

export function noteHelp(info) {
  names.set(info.id, info.name);
  hands.set(info.id, { name: info.name, message: info.message, error: info.error || null, at: Date.now(), routedTo: null });
  applyEvent(pulse, info.id, info.name, { type: 'hand', up: true });
  renderPulse();
}

/** For the student list: { state, error, via, online } */
export function liveInfo(id) {
  const s = pulse.students.get(id);
  if (!s) return { state: 'working' };
  const last = s.runs[s.runs.length - 1];
  return {
    state: studentState(s),
    error: last && !last.ok ? { type: last.errorType, line: last.line } : null,
    online: s.online,
    progress: progressBadge(s.mastery),
  };
}

/** "4 topics" with the levels as a tooltip, from a student's mastery summary. */
function progressBadge(m) {
  if (!m || typeof m.concepts !== 'object') return null;
  const entries = Object.entries(m.concepts).filter(([, l]) => Number.isInteger(l) && l > 0);
  if (!entries.length) return null;
  const words = ['', 'trying', 'getting there', 'confident', 'mastered'];
  const strong = entries.filter(([, l]) => l >= 3).length;
  return {
    label: `${entries.length} topic${entries.length === 1 ? '' : 's'}${strong ? ` · ${strong} strong` : ''}`,
    title: entries.sort((a, b) => b[1] - a[1]).map(([id, l]) => `${conceptLabel(id)}: ${words[l]}`).join('\n')
      + (m.predictions?.tried ? `\nPredictions right: ${m.predictions.right} / ${m.predictions.tried}` : ''),
  };
}

function teacherEvent(who, msg) {
  if (!teacherOn) return;
  names.set(who.id, who.name);
  switch (msg.type) {
    case 'run': {
      const run = {
        type: 'run', ok: !!msg.ok,
        error: msg.ok ? null : {
          type: String(msg.error?.type || 'Error').slice(0, 64),
          message: String(msg.error?.message || '').slice(0, 300),
          line: Number.isInteger(msg.error?.line) ? msg.error.line : null,
          lineText: String(msg.error?.lineText || '').slice(0, 300),
        },
      };
      applyEvent(pulse, who.id, who.name, run);
      if (run.ok && hands.has(who.id)) { hands.delete(who.id); api()?.classroomClearHelp?.(who.id); }
      break;
    }
    case 'done':
      applyEvent(pulse, who.id, who.name, { type: 'done', done: !!msg.done });
      break;
    case 'mastery':
      applyEvent(pulse, who.id, who.name, { type: 'mastery', summary: msg.summary });
      break;
    case 'submission': {
      const str = (v, n) => String(v ?? '').slice(0, n);
      const questions = Array.isArray(msg.questions) ? msg.questions.slice(0, 5).map((q) => ({
        en: str(q?.en, 400), line: Number.isInteger(q?.line) ? q.line : null, lineText: str(q?.lineText, 300),
      })) : [];
      const answers = Array.isArray(msg.answers) ? msg.answers.slice(0, 5).map((a) => str(a, 2000)) : [];
      const recording = validRecording(msg.recording) ? msg.recording : null;
      submissions.set(who.id, {
        name: who.name, at: Date.now(), fileName: str(msg.fileName, 128) || 'main.py', code: str(msg.code, 200_000),
        questions, answers, recording, stats: recording?.stats || null,
      });
      showToast(`${who.name} handed in their work`, 'success', 2400);
      break;
    }
    case 'peer-hint': {
      // Only to the classmate this helper was asked to help
      const to = routes.get(who.id);
      const text = String(msg.text || '').slice(0, 1000).trim();
      if (!to || msg.to !== to || !text) return;
      api()?.classroomSendEvent?.(to, { type: 'peer-hint', from: who.name, text });
      appendTeacherLog(`${who.name} → ${names.get(to) || 'classmate'}: ${text}`);
      break;
    }
    default:
      return;
  }
  onStudentsChanged();
  renderPulse();
  updateHeat();
}

function appendTeacherLog(text) {
  const box = document.getElementById('cr-teacher-chat-messages');
  if (!box) return;
  const row = el('div', 'cr-chat-message cr-chat-message--peer');
  row.append(el('div', 'cr-chat-meta', 'Peer help'), el('div', 'cr-chat-text', text));
  box.append(row);
  box.scrollTop = box.scrollHeight;
}

function updateHeat() {
  if (!teacherOn) return;
  const heat = lineHeat(pulse, getTeacherCode());
  setClassHeat(heat.size ? heat : null);
}

const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : `${m} min ago`;
};

function renderRoutes() {
  const box = document.getElementById('cr-routes');
  if (!box) return;
  box.replaceChildren();
  const chip = (cls, label, title) => {
    const c = el('span', `cr-route ${cls}`, label);
    if (title) c.title = title;
    return c;
  };
  box.append(chip(lan ? 'is-on' : 'is-off', lan ? 'Same Wi-Fi: on' : 'Same Wi-Fi: off', 'Students on this network join automatically'));
  const states = {
    online: ['is-on', 'Internet: on'],
    connecting: ['is-wait', 'Internet: connecting…'],
    reconnecting: ['is-wait', 'Internet: reconnecting…'],
    error: ['is-off', 'Internet: error'],
    invalid: ['is-off', 'Internet: bad relay address'],
    off: ['is-off', 'Internet: off'],
  };
  const [cls, label] = states[relay.state] || states.off;
  box.append(chip(cls, label, relay.state === 'off' ? 'Add a relay server in the class setup to let students join from any network' : relay.message || ''));
  const codeBox = document.getElementById('cr-join-code');
  if (codeBox) {
    codeBox.classList.toggle('hidden', !relay.code);
    const v = codeBox.querySelector('.cr-join-code__value');
    if (v) v.textContent = relay.code ? `${relay.code.slice(0, 3)}-${relay.code.slice(3)}` : '';
  }
}

function renderPulse() {
  const box = document.getElementById('cr-pulse');
  if (!box) return;
  box.replaceChildren();
  if (!teacherOn) return;
  const s = summary(pulse);
  // The bar
  const bar = el('div', 'cr-pulse__bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${s.done} finished, ${s.working} working, ${s.stuck} stuck, ${s.idle} idle`);
  for (const k of ['done', 'working', 'stuck', 'idle']) {
    if (!s[k]) continue;
    const seg = el('span', `cr-pulse__seg is-${k}`);
    seg.style.flexGrow = String(s[k]);
    bar.append(seg);
  }
  const legend = el('div', 'cr-pulse__legend');
  const item = (k, n, label) => { const i = el('span', `cr-pulse__key is-${k}`); i.append(el('b', '', String(n)), document.createTextNode(` ${label}`)); return i; };
  legend.append(item('done', s.done, 'finished'), item('working', s.working, 'working'), item('stuck', s.stuck, 'stuck'));
  if (s.idle) legend.append(item('idle', s.idle, 'idle'));
  const head = el('div', 'cr-pulse__head');
  head.append(el('span', 'cr-pulse__title', 'Class pulse'), legend);
  box.append(head, s.total ? bar : el('div', 'cr-pulse__empty', 'The pulse fills in as students run their code.'));

  const row = el('div', 'cr-pulse__row');
  // Most common bug
  const bug = commonBug(pulse);
  const bugTile = el('div', `cr-bug${bug ? '' : ' is-empty'}`);
  if (bug) {
    bugTile.append(
      el('span', 'cr-bug__kicker', 'Most common bug right now'),
      el('span', 'cr-bug__title', `${bug.type} · ${bug.count} student${bug.count === 1 ? '' : 's'}`),
      el('span', 'cr-bug__names', bug.names.slice(0, 6).join(', ') + (bug.names.length > 6 ? '…' : '')),
    );
    const ex = explainError(bug.sample, { lang: 'en' });
    if (ex) bugTile.append(el('span', 'cr-bug__why', ex.title));
    bugTile.append(btn('cr-action-btn cr-action-btn--sm', 'Explain to everyone', () => {
      api()?.classroomSendEvent?.('*', { type: 'explain', error: { type: bug.sample.type, message: bug.sample.message, line: bug.sample.line, lineText: bug.sample.lineText } });
      showToast('Sent: each student sees it in their own language', 'success', 2400);
    }, 'Every student sees this error explained, in the language they chose'));
  } else {
    bugTile.append(el('span', 'cr-bug__kicker', 'Most common bug right now'), el('span', 'cr-bug__title', 'None — nobody is failing'));
  }
  row.append(bugTile);

  // Hands up
  const queue = el('div', 'cr-hands');
  queue.append(el('span', 'cr-bug__kicker', `Hands up · ${hands.size} waiting`));
  if (!hands.size) queue.append(el('span', 'cr-hands__empty', 'No one is waiting.'));
  const sorted = [...hands.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [id, h] of sorted.slice(0, 6)) {
    const r = el('div', 'cr-hand');
    const who = el('div', 'cr-hand__who');
    who.append(el('b', '', h.name), el('span', 'cr-hand__when', ago(h.at)));
    r.append(who);
    if (h.error?.type) r.append(el('span', 'cr-hand__err', `${h.error.type}${h.error.line ? ` · line ${h.error.line}` : ''}`));
    const actions = el('div', 'cr-hand__actions');
    const helper = h.error?.type ? suggestHelpers(pulse, h.error.type, id)[0] : null;
    if (h.routedTo) {
      actions.append(el('span', 'cr-hand__routed', `${names.get(h.routedTo) || 'A classmate'} is helping`));
    } else if (helper) {
      actions.append(btn('cr-action-btn cr-action-btn--sm', `Ask ${helper.name} to help`, () => routeHelp(id, helper.id), `${helper.name} fixed a ${h.error.type} ${ago(helper.fixedAt)}`));
    }
    actions.append(btn('cr-view-btn', 'Done', () => {
      hands.delete(id);
      applyEvent(pulse, id, h.name, { type: 'hand', up: false });
      api()?.classroomClearHelp?.(id);
      onStudentsChanged();
      renderPulse();
    }, 'Mark as helped'));
    r.append(actions);
    queue.append(r);
  }
  row.append(queue);

  const subs = el('div', 'cr-hands cr-subs');
  subs.append(el('span', 'cr-bug__kicker', `Handed in · ${submissions.size}`));
  if (!submissions.size) subs.append(el('span', 'cr-hands__empty', 'Students hand in with a short viva about their code.'));
  for (const [, sub] of [...submissions.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 6)) {
    const r = el('div', 'cr-hand');
    const who = el('div', 'cr-hand__who');
    who.append(el('b', '', sub.name), el('span', 'cr-hand__when', ago(sub.at)));
    r.append(who, el('span', 'cr-sub__stats', sub.stats ? describeStats(sub.stats) : sub.fileName));
    const actions = el('div', 'cr-hand__actions');
    actions.append(btn('cr-view-btn', 'Open', () => openReplay({
      title: `${sub.name} · ${sub.fileName}`, recording: sub.recording, code: sub.code, questions: sub.questions, answers: sub.answers,
    }), 'See the viva answers and replay how the file was written'));
    r.append(actions);
    subs.append(r);
  }
  row.append(subs);
  box.append(row);
}

function routeHelp(needyId, helperId) {
  const h = hands.get(needyId);
  if (!h) return;
  h.routedTo = helperId;
  routes.set(helperId, needyId);
  api()?.classroomSendEvent?.(helperId, {
    type: 'help-route', role: 'helper', to: needyId, name: h.name, error: h.error, code: String(getStudentCode(needyId) || '').slice(0, 20_000),
  });
  api()?.classroomSendEvent?.(needyId, { type: 'help-route', role: 'helped', name: names.get(helperId) || 'A classmate' });
  showToast(`${names.get(helperId)} will help ${h.name}`, 'success', 2400);
  renderPulse();
}

// ══════════════════════════════════════════════════════════════════
// STUDENT
// ══════════════════════════════════════════════════════════════════

let inClass = false;
let done = false;

export function studentJoined() {
  inClass = true;
  done = false;
  updateDoneButtons();
  // Progress so far (latest wins)
  api()?.classroomStudentSendEvent?.({ type: 'mastery', summary: getMasterySummary() }, 'mastery');
}

export function studentLeft() {
  inClass = false;
  shareLeft();
  document.getElementById('cr-help-card')?.remove();
}

function studentRan(run) {
  if (!inClass) return;
  const e = run.error;
  api()?.classroomStudentSendEvent?.({
    type: 'run', ok: run.ok, concepts: run.concepts, predictedRight: run.predictedRight,
    error: e ? { type: e.type, message: e.message, line: e.line, lineText: e.lineText } : null,
  });
  api()?.classroomStudentSendEvent?.({ type: 'mastery', summary: run.summary }, 'mastery');
  if (done && !run.ok) setDone(false); // working again
}

/** Hand in the open file: the viva first, then the code, the answers and how it was written. */
export async function handIn() {
  if (!inClass) return;
  const f = getCurrentFile();
  if (!f.code.trim()) { showToast('Write some code before handing in', 'info', 2000); return; }
  const res = await openViva({ code: f.code, fileName: f.fileName, mode: 'class' });
  if (!res) return;
  const payload = {
    type: 'submission', fileName: f.fileName, code: f.code.slice(0, 200_000), lang: getExplainLang(),
    questions: res.questions.map((q) => ({ en: q.en, line: q.line, lineText: q.lineText })),
    answers: res.answers.map((a) => a.slice(0, 2000)),
    recording: recordingFor(f.tabId, f.code),
  };
  // Very long edit histories do not fit in one message: send the totals only
  if (JSON.stringify(payload).length > 900_000) payload.recording = { ...payload.recording, events: [], truncated: true };
  api()?.classroomStudentSendEvent?.(payload);
  setDone(true);
  showToast(getExplainLang() === 'hi' ? 'आपका काम जमा हो गया' : 'Handed in', 'success', 2200);
}

export function setDone(on) {
  done = !!on;
  updateDoneButtons();
  if (inClass) api()?.classroomStudentSendEvent?.({ type: 'done', done }, 'done');
}
export const isDone = () => done;

function updateDoneButtons() {
  document.querySelectorAll('[data-done-btn]').forEach((b) => {
    b.setAttribute('aria-pressed', String(done));
    b.textContent = done ? "I'm done ✓" : "I'm done";
  });
}

/** The error to attach to "Ask for help" (the last failed run). */
export function helpError() {
  const e = getLastError();
  return e ? { type: e.type, message: e.message, line: e.line } : null;
}

function studentEvent(msg) {
  if (handleShareEvent(msg)) return;
  switch (msg.type) {
    case 'explain':
      if (msg.error?.type) showExplanation({ ...msg.error, code: '' }, { fromTeacher: true });
      break;
    case 'help-route':
      if (msg.role === 'helper') helperCard(msg);
      else if (msg.role === 'helped') {
        showToast(`${String(msg.name || 'A classmate')} will help you`, 'success', 4000);
      }
      break;
    case 'peer-hint':
      hintCard(String(msg.from || 'A classmate'), String(msg.text || ''));
      break;
    default:
  }
}

function floatingCard(title) {
  document.getElementById('cr-help-card')?.remove();
  const card = el('section', 'cr-help-card');
  card.id = 'cr-help-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', title);
  const head = el('div', 'cr-help-card__head');
  head.append(el('span', 'cr-help-card__title', title), btn('cr-help-card__close', '×', () => card.remove(), 'Close'));
  card.append(head);
  document.body.append(card);
  return card;
}

/** A classmate asked for help and the teacher picked you. */
function helperCard(msg) {
  const hi = getExplainLang() === 'hi';
  const name = String(msg.name || 'A classmate');
  const card = floatingCard(hi ? `${name} की मदद करें` : `Help ${name}`);
  const err = msg.error?.type ? `${msg.error.type}${msg.error.line ? ` · line ${msg.error.line}` : ''}` : '';
  card.append(el('p', 'cr-help-card__lead', hi
    ? `आपके शिक्षक ने आपसे ${name} की मदद करने को कहा है। आपने हाल ही में यही त्रुटि ठीक की थी।`
    : `Your teacher asked you to help ${name}. You fixed this kind of error a moment ago.`));
  if (err) card.append(el('span', 'cr-help-card__err', err));
  if (msg.code) {
    const pre = el('pre', 'cr-help-card__code', String(msg.code).slice(0, 20_000));
    card.append(pre);
  }
  const box = el('textarea', 'cr-help-card__box');
  box.rows = 3;
  box.placeholder = hi ? 'एक संकेत लिखें (पूरा उत्तर नहीं)' : 'Write a hint (not the whole answer)';
  box.addEventListener('keydown', (e) => e.stopPropagation());
  const send = btn('cr-action-btn cr-action-btn--sm', hi ? 'संकेत भेजें' : 'Send hint', () => {
    const text = box.value.trim();
    if (!text) return;
    api()?.classroomStudentSendEvent?.({ type: 'peer-hint', to: msg.to, text });
    box.value = '';
    showToast(hi ? 'संकेत भेजा गया' : 'Hint sent', 'success', 1800);
  });
  card.append(box, send);
}

function hintCard(from, text) {
  const hi = getExplainLang() === 'hi';
  const card = floatingCard(hi ? `${from} का संकेत` : `A hint from ${from}`);
  card.append(el('p', 'cr-help-card__hint', text));
}

function renderLinkStatus(info) {
  const t = document.getElementById('cr-link-status');
  const words = {
    searching: 'Looking for your class…',
    connected: info.via === 'lan' ? 'Connected · same Wi-Fi' : 'Connected · over the internet',
    reconnecting: 'Reconnecting… your work is safe and will sync',
    'teacher-away': 'Your teacher is reconnecting…',
  };
  const text = words[info.state] || '';
  if (t) {
    t.textContent = text;
    t.dataset.state = info.state;
  }
  const tb = document.getElementById('cr-toolbar-teacher-name');
  if (tb && info.state !== 'connected') tb.textContent = text;
  else if (tb && info.teacher) tb.textContent = `${info.teacher} · ${info.via === 'lan' ? 'Wi-Fi' : 'Internet'}`;
  document.documentElement.toggleAttribute('data-class-reconnecting', info.state === 'reconnecting' || info.state === 'teacher-away');
}

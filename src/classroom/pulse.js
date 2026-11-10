/**
 * Class pulse (teacher side): who is done, working or stuck, the most
 * common bug right now, which classmate could help, and where on the
 * teacher's own code the class is stuck. Fed by the run events students'
 * apps send; pure functions so they can be tested without a classroom.
 */

const STUCK_AFTER_MS = 3 * 60_000;   // failing this long in a row = stuck
const IDLE_AFTER_MS = 10 * 60_000;   // no runs or edits for this long = idle
const HELPER_WINDOW_MS = 30 * 60_000; // a fix this recent makes a good helper

export function createPulse() {
  return { students: new Map() };
}

function entry(pulse, id, name) {
  let s = pulse.students.get(id);
  if (!s) {
    s = { id, name: name || '', runs: [], hand: false, done: false, lastActive: 0, failingSince: 0, fixes: {}, online: true, mastery: null };
    pulse.students.set(id, s);
  }
  if (name) s.name = name;
  return s;
}

/**
 * Apply a student event.
 *   { type: 'run', ok, error: { type, message, line, lineText }, concepts, predictedRight }
 *   { type: 'done', done }   { type: 'hand', up }   { type: 'typing' }   { type: 'mastery', summary }
 */
export function applyEvent(pulse, id, name, msg, now = Date.now()) {
  const s = entry(pulse, id, name);
  switch (msg?.type) {
    case 'run': {
      const run = {
        ok: !!msg.ok,
        errorType: msg.ok ? null : String(msg.error?.type || 'Error').slice(0, 64),
        message: msg.ok ? '' : String(msg.error?.message || '').slice(0, 300),
        line: Number.isInteger(msg.error?.line) ? msg.error.line : null,
        lineText: msg.ok ? '' : String(msg.error?.lineText || '').slice(0, 300),
        at: now,
      };
      const prev = s.runs[s.runs.length - 1];
      s.runs.push(run);
      if (s.runs.length > 20) s.runs.shift();
      s.lastActive = now;
      if (run.ok) {
        // A failing streak ended: those error kinds were fixed now
        for (const r of s.runs.slice(0, -1).reverse()) {
          if (r.ok) break;
          if (r.errorType) s.fixes[r.errorType] = now;
        }
        s.failingSince = 0;
        s.hand = false;
      } else if (!prev || prev.ok || !s.failingSince) {
        s.failingSince = now;
      }
      break;
    }
    case 'done': s.done = !!msg.done; s.lastActive = now; break;
    case 'hand': s.hand = !!msg.up; s.lastActive = now; break;
    case 'typing': s.lastActive = now; break;
    case 'mastery': s.mastery = msg.summary && typeof msg.summary === 'object' ? msg.summary : null; break;
    default:
  }
  return s;
}

export function setOnline(pulse, id, online) {
  const s = pulse.students.get(id);
  if (s) s.online = online;
}

export function removeStudent(pulse, id) { pulse.students.delete(id); }

/** 'done' | 'stuck' | 'working' | 'idle' */
export function studentState(s, now = Date.now()) {
  if (s.hand) return 'stuck';
  if (s.done) return 'done';
  const last = s.runs[s.runs.length - 1];
  const prev = s.runs[s.runs.length - 2];
  if (last && !last.ok) {
    if (prev && !prev.ok) return 'stuck';
    if (s.failingSince && now - s.failingSince >= STUCK_AFTER_MS) return 'stuck';
  }
  if (!s.lastActive || now - s.lastActive > IDLE_AFTER_MS) return 'idle';
  return 'working';
}

/** Counts for the pulse bar. */
export function summary(pulse, now = Date.now()) {
  const out = { done: 0, working: 0, stuck: 0, idle: 0, total: 0 };
  for (const s of pulse.students.values()) {
    out[studentState(s, now)]++;
    out.total++;
  }
  return out;
}

/** The error most students are failing with right now: { type, count, names, sample } or null. */
export function commonBug(pulse, now = Date.now()) {
  const byType = new Map();
  for (const s of pulse.students.values()) {
    const last = s.runs[s.runs.length - 1];
    if (!last || last.ok || now - last.at > IDLE_AFTER_MS) continue;
    const g = byType.get(last.errorType) || { type: last.errorType, count: 0, names: [], sample: { type: last.errorType, message: last.message, line: last.line, lineText: last.lineText } };
    g.count++;
    g.names.push(s.name);
    byType.set(last.errorType, g);
  }
  let best = null;
  for (const g of byType.values()) if (!best || g.count > best.count) best = g;
  return best; // one student still counts; the UI words it differently
}

/**
 * Classmates who fixed this kind of error recently and are doing fine now,
 * best first: [{ id, name, fixedAt }].
 */
export function suggestHelpers(pulse, errorType, exceptId, now = Date.now()) {
  const out = [];
  for (const s of pulse.students.values()) {
    if (s.id === exceptId || !s.online) continue;
    const at = s.fixes[errorType];
    if (!at || now - at > HELPER_WINDOW_MS) continue;
    const state = studentState(s, now);
    if (state === 'stuck') continue;
    out.push({ id: s.id, name: s.name, fixedAt: at, state });
  }
  // Finished students first (they have time), then the most recent fix
  return out.sort((a, b) => (b.state === 'done') - (a.state === 'done') || b.fixedAt - a.fixedAt);
}

// Spacing differs between students copying the same demo line: compare without it
const normLine = (t) => String(t || '').replace(/#.*$/, '').replace(/\s+/g, '');

/**
 * Where on the teacher's code the class is stuck: line number → students
 * whose failing line is the same code (students following the demo type
 * the same lines, maybe at a different line number).
 * @returns {Map<number, { count: number, names: string[], types: string[] }>}
 */
export function lineHeat(pulse, teacherCode, now = Date.now()) {
  const heat = new Map();
  const lines = String(teacherCode || '').split('\n').map(normLine);
  for (const s of pulse.students.values()) {
    const last = s.runs[s.runs.length - 1];
    if (!last || last.ok || now - last.at > IDLE_AFTER_MS) continue;
    const want = normLine(last.lineText);
    if (!want || want.length < 3) continue;
    // Same text: pick the occurrence nearest the student's own line number
    let best = -1;
    lines.forEach((l, i) => {
      if (l !== want) return;
      if (best < 0 || (last.line && Math.abs(i + 1 - last.line) < Math.abs(best + 1 - last.line))) best = i;
    });
    if (best < 0) continue;
    const h = heat.get(best + 1) || { count: 0, names: [], types: [] };
    h.count++;
    h.names.push(s.name);
    if (!h.types.includes(last.errorType)) h.types.push(last.errorType);
    heat.set(best + 1, h);
  }
  return heat;
}

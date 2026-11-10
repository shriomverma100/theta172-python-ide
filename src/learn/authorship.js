/**
 * Authorship: how a file came to be. Every edit is recorded with where it
 * came from — typed, pasted, written by AI Fix, typed by the teacher (live
 * edit) or loaded from disk — so the teacher can replay a submission and see
 * which parts the student really wrote. Pure: the editor hook feeds changes.
 *
 * Kinds: 't' typed · 'p' pasted · 'a' AI · 'r' teacher (remote) · 'l' loaded
 */

export const KINDS = { t: 'Typed', p: 'Pasted', a: 'AI', r: 'Teacher', l: 'Loaded' };
const MAX_EVENTS = 20_000;
const MAX_TEXT = 400_000;

/** Insert/delete in a run-length list of { len, k } spans. */
function splice(spans, pos, del, insLen, k) {
  const out = [];
  let at = 0;
  let inserted = false;
  const put = (len, kind) => {
    if (len <= 0) return;
    const last = out[out.length - 1];
    if (last && last.k === kind) last.len += len;
    else out.push({ len, k: kind });
  };
  for (const s of spans) {
    const start = at;
    const end = at + s.len;
    at = end;
    // Part before the change
    put(Math.min(end, pos) - start, s.k);
    if (!inserted && end >= pos && pos >= start) {
      put(insLen, k);
      inserted = true;
    }
    // Part after the deleted range
    const afterFrom = Math.max(start, pos + del);
    put(end - afterFrom, s.k);
  }
  if (!inserted) put(insLen, k);
  return out;
}

export class Authorship {
  constructor(base = '', start = Date.now()) {
    this.base = String(base).slice(0, MAX_TEXT);
    this.start = start;
    this.events = []; // { t, k, at, del, ins }
    this.spans = this.base ? [{ len: this.base.length, k: 'l' }] : [];
    this.truncated = false;
  }

  /**
   * Record changes, in order, as (position in the new text, deleted length, inserted text).
   * @param {{ at: number, del: number, ins: string }[]} changes
   * @param {string} kind
   */
  record(changes, kind, now = Date.now()) {
    for (const c of changes) {
      this.spans = splice(this.spans, c.at, c.del, c.ins.length, kind);
      if (this.events.length < MAX_EVENTS) this.events.push({ t: now - this.start, k: kind, at: c.at, del: c.del, ins: c.ins });
      else this.truncated = true; // the totals stay right; the replay stops here
    }
  }

  /** Characters of the current text by kind: { t, p, a, r, l, total }. */
  stats() {
    const out = { t: 0, p: 0, a: 0, r: 0, l: 0, total: 0 };
    for (const s of this.spans) { out[s.k] = (out[s.k] || 0) + s.len; out.total += s.len; }
    return out;
  }

  toJSON() {
    return { v: 1, base: this.base, start: this.start, events: this.events, truncated: this.truncated, stats: this.stats() };
  }
}

/** The text and its kinds after the first `n` events of a recording. */
export function replayAt(rec, n) {
  let text = rec.base || '';
  let spans = text ? [{ len: text.length, k: 'l' }] : [];
  const upto = Math.max(0, Math.min(n, rec.events.length));
  for (let i = 0; i < upto; i++) {
    const e = rec.events[i];
    text = text.slice(0, e.at) + e.ins + text.slice(e.at + e.del);
    spans = splice(spans, e.at, e.del, e.ins.length, e.k);
  }
  return { text, spans, t: upto ? rec.events[upto - 1].t : 0 };
}

/** Plain checks on a recording that came over the network. */
export function validRecording(r) {
  if (!r || r.v !== 1 || typeof r.base !== 'string' || !Array.isArray(r.events)) return false;
  return r.events.length <= MAX_EVENTS && r.events.every((e) => e && typeof e.ins === 'string'
    && Number.isInteger(e.at) && Number.isInteger(e.del) && e.at >= 0 && e.del >= 0 && typeof e.k === 'string' && KINDS[e.k]);
}

/** "62% typed · 30% pasted · 8% AI" */
export function describeStats(s) {
  if (!s?.total) return 'Empty';
  const pct = (n) => Math.round((100 * (n || 0)) / s.total);
  const parts = [];
  for (const k of ['t', 'p', 'a', 'r', 'l']) if (s[k]) parts.push(`${pct(s[k])}% ${KINDS[k].toLowerCase()}`);
  return parts.join(' · ');
}

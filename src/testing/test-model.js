/**
 * The tests of a project and their latest results, from the test runner's
 * events. Pure: the Tests view and the editor marks read from it.
 */

export const DONE = new Set(['passed', 'failed', 'skipped', 'xfail', 'xpass', 'error']);

export function createTests() {
  return { items: new Map(), errors: [], collecting: false, running: false, runIds: null, duration: 0 };
}

const fileOf = (nodeid) => nodeid.split('::')[0];

/** Apply one runner event. Returns true when something visible changed. */
export function applyEvent(m, ev) {
  switch (ev.type) {
    case 'item': {
      const old = m.items.get(ev.nodeid);
      m.items.set(ev.nodeid, {
        nodeid: ev.nodeid, file: ev.file, line: ev.line, name: ev.name, cls: ev.cls || null,
        status: old?.status || 'unknown', message: old?.message || '', longrepr: old?.longrepr || '',
        duration: old?.duration || 0, stdout: old?.stdout || '', failLine: old?.failLine || null, failPath: old?.failPath || null,
        seen: m.collectStamp,
      });
      return true;
    }
    case 'collect-error':
      m.errors.push({ nodeid: ev.nodeid, message: ev.message || '' });
      return true;
    case 'start': {
      const t = m.items.get(ev.nodeid);
      if (t) t.status = 'running';
      return !!t;
    }
    case 'result': {
      let t = m.items.get(ev.nodeid);
      if (!t) { // run without collecting first
        t = { nodeid: ev.nodeid, file: ev.path || null, line: null, name: ev.nodeid.split('::').pop(), cls: null };
        m.items.set(ev.nodeid, t);
      }
      t.status = ev.outcome === 'failed' && ev.when !== 'call' ? 'error' : ev.outcome;
      t.message = ev.message || '';
      t.longrepr = ev.longrepr || '';
      t.duration = ev.duration || 0;
      t.stdout = ev.stdout || '';
      t.failLine = ev.line || null;
      t.failPath = ev.path || null;
      return true;
    }
    default:
      return false;
  }
}

/** A discovery starts: errors reset; tests not found again are dropped when it ends. */
export function beginCollect(m) {
  m.collecting = true;
  m.errors = [];
  m.collectStamp = (m.collectStamp || 0) + 1;
}

export function endCollect(m) {
  m.collecting = false;
  for (const [id, t] of m.items) if (t.seen !== m.collectStamp) m.items.delete(id);
}

/** A run starts: the chosen tests (all when ids is empty) wait in line. */
export function beginRun(m, ids = []) {
  m.running = true;
  m.duration = 0;
  m.startedAt = Date.now(); // the run time shown is the real time, not the sum of tests
  m.runIds = ids.length ? ids : null;
  for (const t of m.items.values()) if (inRun(t.nodeid, ids)) t.status = 'queued';
}

/** A run ended (or was stopped): tests still waiting go back to their last state. */
export function endRun(m, now = Date.now()) {
  m.running = false;
  if (m.startedAt) m.duration = (now - m.startedAt) / 1000;
  for (const t of m.items.values()) if (t.status === 'queued' || t.status === 'running') t.status = 'unknown';
}

/** Does node id `id` belong to a run of `ids` (a file, a class or a test)? */
export function inRun(id, ids) {
  if (!ids?.length) return true;
  return ids.some((x) => id === x || id.startsWith(`${x}::`));
}

/** File → class → test, in file and line order. */
export function tree(m) {
  const files = new Map();
  for (const t of m.items.values()) {
    const key = fileOf(t.nodeid);
    let f = files.get(key);
    if (!f) { f = { id: key, file: t.file, tests: [], classes: new Map() }; files.set(key, f); }
    if (t.cls) {
      const cid = t.nodeid.split('::').slice(0, -1).join('::');
      let c = f.classes.get(cid);
      if (!c) { c = { id: cid, name: t.cls, tests: [] }; f.classes.set(cid, c); }
      c.tests.push(t);
    } else f.tests.push(t);
  }
  const byLine = (a, b) => (a.line || 0) - (b.line || 0);
  return [...files.values()].sort((a, b) => a.id.localeCompare(b.id)).map((f) => ({
    ...f,
    tests: f.tests.sort(byLine),
    classes: [...f.classes.values()].map((c) => ({ ...c, tests: c.tests.sort(byLine) })).sort((a, b) => byLine(a.tests[0], b.tests[0])),
  }));
}

/** The status of a group: failed beats running beats passed … */
export function groupStatus(tests) {
  const has = (s) => tests.some((t) => t.status === s);
  if (has('failed') || has('error')) return 'failed';
  if (has('running')) return 'running';
  if (has('queued')) return 'queued';
  if (tests.length && tests.every((t) => ['passed', 'xfail', 'skipped', 'xpass'].includes(t.status)) && has('passed')) return 'passed';
  if (tests.length && tests.every((t) => t.status === 'skipped')) return 'skipped';
  return 'unknown';
}

export function summary(m) {
  const out = { total: m.items.size, passed: 0, failed: 0, skipped: 0, notRun: 0, duration: m.duration };
  for (const t of m.items.values()) {
    if (t.status === 'passed' || t.status === 'xpass') out.passed++;
    else if (t.status === 'failed' || t.status === 'error') out.failed++;
    else if (t.status === 'skipped' || t.status === 'xfail') out.skipped++;
    else out.notRun++;
  }
  return out;
}

export function failedIds(m) {
  return [...m.items.values()].filter((t) => t.status === 'failed' || t.status === 'error').map((t) => t.nodeid);
}

const samePath = (a, b) => !!a && !!b && a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** Marks for one open file: Map(line → { status, nodeid, message }) for each test function. */
export function fileMarks(m, filePath) {
  const marks = new Map();
  if (!filePath) return marks;
  for (const t of m.items.values()) {
    if (t.line && samePath(t.file, filePath)) marks.set(t.line, { status: t.status, nodeid: t.nodeid, message: t.message });
  }
  return marks;
}

/** Is this a test file (pytest's default naming)? */
export const isTestFile = (p) => /(^|[\\/])(test_[^\\/]*|[^\\/]*_test)\.py$/i.test(p || '');

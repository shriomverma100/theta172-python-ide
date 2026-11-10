/**
 * Predict-then-run: the student writes what they expect the program to
 * print, runs it, and sees how close they were, line by line.
 */

/** Lines for comparing: trailing spaces and blank lines at the end don't matter. */
export function outputLines(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

/** Loosely equal: same words and numbers, ignoring case and spacing (2.0 == 2). */
function close(a, b) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\b(\d+)\.0\b/g, '$1');
  return norm(a) === norm(b);
}

/**
 * Compare a prediction with the real output.
 * @returns {{ right: boolean, exact: boolean, score: number, rows: { expected: string, actual: string, status: 'same'|'close'|'different'|'missing'|'extra' }[] }}
 */
export function comparePrediction(predicted, actual) {
  const p = outputLines(predicted);
  const a = outputLines(actual);
  const rows = [];
  const n = Math.max(p.length, a.length);
  let good = 0;
  for (let i = 0; i < n; i++) {
    const e = p[i];
    const g = a[i];
    let status;
    if (e === undefined) status = 'extra';
    else if (g === undefined) status = 'missing';
    else if (e === g) status = 'same';
    else if (close(e, g)) status = 'close';
    else status = 'different';
    if (status === 'same' || status === 'close') good++;
    rows.push({ expected: e ?? '', actual: g ?? '', status });
  }
  const exact = rows.every((r) => r.status === 'same');
  return { exact, right: rows.every((r) => r.status === 'same' || r.status === 'close'), score: n ? good / n : 1, rows };
}

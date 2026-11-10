/**
 * Marks beside each test function in the editor: ▶ not run yet, ✓ passed,
 * ✗ failed, ↷ skipped, … running. Clicking a mark runs that test.
 */
import { gutter, GutterMarker } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

const setMarksEffect = StateEffect.define();
let runHandler = null;

const testMarksField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setMarksEffect)) return e.value;
    return value;
  },
});

const ICON = { unknown: '▶', queued: '…', running: '…', passed: '✓', xpass: '✓', failed: '✗', error: '✗', skipped: '↷', xfail: '↷' };
const WORD = { unknown: 'Run this test', queued: 'Waiting to run', running: 'Running', passed: 'Passed: run again', xpass: 'Passed unexpectedly', failed: 'Failed: run again', error: 'Error: run again', skipped: 'Skipped', xfail: 'Expected to fail' };

class TestMarker extends GutterMarker {
  constructor(mark) { super(); this.mark = mark; }
  eq(other) { return other.mark.status === this.mark.status && other.mark.nodeid === this.mark.nodeid; }
  toDOM() {
    const d = document.createElement('span');
    d.className = `cm-test-mark is-${this.mark.status}`;
    d.textContent = ICON[this.mark.status] || '▶';
    d.title = this.mark.message && (this.mark.status === 'failed' || this.mark.status === 'error')
      ? `${WORD[this.mark.status]}\n${this.mark.message}` : WORD[this.mark.status] || 'Run this test';
    return d;
  }
}

export const testGutterExtension = [
  testMarksField,
  gutter({
    class: 'cm-test-gutter',
    lineMarker(view, line) {
      const marks = view.state.field(testMarksField, false);
      if (!marks) return null;
      const m = marks.get(view.state.doc.lineAt(line.from).number);
      return m ? new TestMarker(m) : null;
    },
    lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setMarksEffect))),
    domEventHandlers: {
      mousedown(view, line) {
        const marks = view.state.field(testMarksField, false);
        const m = marks?.get(view.state.doc.lineAt(line.from).number);
        if (!m || !runHandler) return false;
        runHandler(m.nodeid);
        return true;
      },
    },
  }),
];

/** Show test marks in a view: Map(line → { status, nodeid, message }), or null. */
export function setTestMarks(view, marks) {
  if (!view) return;
  const value = marks && marks.size ? marks : null;
  const cur = view.state.field(testMarksField, false);
  if (cur === undefined || (!cur && !value)) return;
  view.dispatch({ effects: setMarksEffect.of(value) });
}

/** fn(nodeid) when a mark is clicked. */
export function setTestRunHandler(fn) { runHandler = fn; }

/**
 * Change markers in the editor gutter, like VS Code: a green bar for added
 * lines, blue for changed lines and a red notch where lines were deleted,
 * compared with the version git has (the index, or HEAD).
 *
 * The comparison text lives in each tab's editor state, so every tab keeps
 * its own; app/git.js sets it with setGitBaseline().
 */
import { StateField, StateEffect, RangeSet, Text } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { Chunk } from '@codemirror/merge';

/** The text to compare with (a string), or null for "not in a repository". */
export const setBaselineEffect = StateEffect.define();

const baselineField = StateField.define({
  create: () => null,
  update(base, tr) {
    for (const e of tr.effects) if (e.is(setBaselineEffect)) return e.value == null ? null : Text.of(e.value.split(/\r?\n/));
    return base;
  },
});

class ChangeMarker extends GutterMarker {
  constructor(kind) {
    super();
    this.kind = kind;
  }

  eq(other) { return other.kind === this.kind; }

  toDOM() {
    const el = document.createElement('span');
    el.className = `cm-git-mark cm-git-mark--${this.kind}`;
    el.title = { added: 'Added line', modified: 'Changed line', deleted: 'Lines were deleted here' }[this.kind];
    return el;
  }
}
const MARK = { added: new ChangeMarker('added'), modified: new ChangeMarker('modified'), deleted: new ChangeMarker('deleted') };

/**
 * Which lines changed between `base` and `doc` (both Text).
 * @returns {{ line: number, kind: 'added'|'modified'|'deleted' }[]} 1-based lines of `doc`
 */
export function lineChanges(base, doc) {
  const out = [];
  for (const c of Chunk.build(base, doc)) {
    const first = doc.lineAt(Math.min(c.fromB, doc.length)).number;
    if (c.fromB >= c.toB) {
      // Only deleted text: mark the line where it used to be
      out.push({ line: first, kind: 'deleted' });
      continue;
    }
    // toB is one past the chunk's last line (it may point past the end of the document)
    const last = doc.lineAt(Math.max(c.fromB, Math.min(c.toB - 1, doc.length))).number;
    const kind = c.fromA >= c.toA ? 'added' : 'modified';
    for (let n = first; n <= last; n++) out.push({ line: n, kind });
  }
  return out;
}

const changesField = StateField.define({
  create: () => RangeSet.empty,
  update(set, tr) {
    const base = tr.state.field(baselineField);
    const baseChanged = tr.effects.some((e) => e.is(setBaselineEffect));
    if (!base) return RangeSet.empty;
    if (!tr.docChanged && !baseChanged) return set;
    // Large files: skip (a full diff on every keystroke would be slow)
    if (tr.state.doc.length > 400_000) return RangeSet.empty;
    const doc = tr.state.doc;
    const marks = lineChanges(base, doc).map(({ line, kind }) => MARK[kind].range(doc.line(line).from));
    return RangeSet.of(marks, true);
  },
});

const gitGutter = gutter({
  class: 'cm-git-gutter',
  markers: (view) => view.state.field(changesField),
});

export const gitGutterExtension = [baselineField, changesField, gitGutter, EditorView.baseTheme({
  '.cm-git-gutter': { width: '4px', marginRight: '2px' },
  '.cm-git-gutter .cm-gutterElement': { padding: '0' },
})];

/** True when the state is comparing with a git version. */
export function hasBaseline(state) {
  return !!state.field(baselineField, false);
}

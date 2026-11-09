/**
 * Debugger marks inside the editor:
 *   - breakpoints: a gutter of red dots that move with the text as you edit
 *     (they live in each tab's editor state, so every tab keeps its own)
 *   - the paused line: highlighted, with an arrow in the breakpoint gutter
 */
import { StateField, StateEffect, RangeSet, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, GutterMarker, gutter } from '@codemirror/view';

/** Toggle a breakpoint on the line starting at `pos`. */
export const toggleBreakpointEffect = StateEffect.define({ map: (pos, mapping) => mapping.mapPos(pos) });
/** Replace all breakpoints (1-based line numbers). */
export const setBreakpointsEffect = StateEffect.define();
/** The paused line (1-based), or null. */
export const setPausedLineEffect = StateEffect.define();

class BreakpointMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-bp-dot';
    el.title = 'Breakpoint (click to remove)';
    return el;
  }
}
const breakpointMarker = new BreakpointMarker();

class PausedMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-paused-arrow';
    el.title = 'Paused here';
    return el;
  }
}
const pausedMarker = new PausedMarker();

export const breakpointField = StateField.define({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(toggleBreakpointEffect)) {
        let exists = false;
        set.between(e.value, e.value, () => { exists = true; });
        set = set.update(exists
          ? { filter: (from) => from !== e.value }
          : { add: [breakpointMarker.range(e.value)] });
      } else if (e.is(setBreakpointsEffect)) {
        const builder = new RangeSetBuilder();
        const doc = tr.state.doc;
        for (const n of [...new Set(e.value)].filter((l) => l >= 1 && l <= doc.lines).sort((a, b) => a - b)) {
          builder.add(doc.line(n).from, doc.line(n).from, breakpointMarker);
        }
        set = builder.finish();
      }
    }
    return set;
  },
});

const pausedField = StateField.define({
  create: () => null,
  update(line, tr) {
    for (const e of tr.effects) if (e.is(setPausedLineEffect)) return e.value;
    if (line != null && tr.docChanged) return null; // edited while paused: the mark no longer fits
    return line;
  },
  provide: (f) => EditorView.decorations.from(f, (line) => (view) => {
    if (line == null || line > view.state.doc.lines) return Decoration.none;
    return Decoration.set([Decoration.line({ class: 'cm-debug-paused-line' }).range(view.state.doc.line(line).from)]);
  }),
});

/** 1-based line numbers with a breakpoint in `state` (empty if the state has no field). */
export function breakpointLines(state) {
  const set = state?.field(breakpointField, false);
  if (!set) return [];
  const lines = [];
  set.between(0, state.doc.length, (from) => { lines.push(state.doc.lineAt(from).number); });
  return [...new Set(lines)];
}

let onBreakpointsChanged = null;
/** fn(view) after the user adds or removes a breakpoint in the gutter. */
export function setBreakpointListener(fn) { onBreakpointsChanged = fn; }

export function toggleBreakpointAt(view, pos) {
  const line = view.state.doc.lineAt(pos);
  view.dispatch({ effects: toggleBreakpointEffect.of(line.from) });
  onBreakpointsChanged?.(view);
}

const breakpointGutter = gutter({
  class: 'cm-bp-gutter',
  markers: (view) => {
    const bps = view.state.field(breakpointField);
    const paused = view.state.field(pausedField);
    if (paused == null || paused > view.state.doc.lines) return bps;
    return RangeSet.of([...collect(bps), pausedMarker.range(view.state.doc.line(paused).from)], true);
  },
  initialSpacer: () => breakpointMarker,
  domEventHandlers: {
    mousedown(view, line) {
      toggleBreakpointAt(view, line.from);
      return true;
    },
  },
});

function collect(set) {
  const out = [];
  for (let it = set.iter(); it.value; it.next()) out.push(it.value.range(it.from));
  return out;
}

/** The editor extension: breakpoint gutter, breakpoints and the paused line. */
export const debugEditorExtension = [breakpointField, pausedField, breakpointGutter];

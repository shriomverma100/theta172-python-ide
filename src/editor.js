/**
 * THETA172 — CodeMirror 6 Editor Module
 * Dual theme: Light (white surface) / Dark (black surface).
 * Smooth caret, bracket matching, Python language support.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter,
         highlightSpecialChars, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor,
         highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentOnInput, bracketMatching,
         foldGutter, foldKeymap, defaultHighlightStyle,
         HighlightStyle } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

// ── Compartments for dynamic reconfiguration ──────────────────
const themeCompartment = new Compartment();
const fontSizeCompartment = new Compartment();

// ── THETA172 DARK THEME ───────────────────────────────────────
const theta172Dark = EditorView.theme({
  '&': {
    backgroundColor: '#111111',
    color: '#E8E8E6',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '15px',
  },
  '.cm-content': {
    caretColor: '#FF2D00',
    lineHeight: '25px',
    letterSpacing: '0.2px',
    padding: '20px 0 60px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#FF2D00',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#FF2D0055 !important',
  },
  '& .cm-line ::selection': {
    backgroundColor: '#FF2D0055 !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#1A1A18',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#1A1A18',
    color: '#AAAAAA',
  },
  '.cm-gutters': {
    backgroundColor: '#111111',
    color: '#5E5E5C',
    border: 'none',
    minWidth: '3em',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
  },
  '.cm-foldGutter': {
    color: '#5E5E5C',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(255,45,0,0.15)',
    outline: '1px solid rgba(255,45,0,0.4)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255,45,0,0.3)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(255,45,0,0.1)',
  },
  '.cm-tooltip': {
    backgroundColor: '#141414',
    border: '1px solid #222220',
    color: '#EAEAE8',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(255,45,0,0.15)',
  },
  '.cm-panels': {
    backgroundColor: '#141414',
    color: '#EAEAE8',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid #222220',
  },
  '.cm-textfield': {
    backgroundColor: '#1A1A18',
    border: '1px solid #2E2E2C',
    color: '#EAEAE8',
  },
  '.cm-button': {
    backgroundColor: '#1A1A18',
    border: '1px solid #2E2E2C',
    color: '#EAEAE8',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: '#1E1E1C80 transparent',
  },
}, { dark: true });

const theta172DarkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#D6A0F0', fontWeight: 'bold' },
  { tag: tags.comment, color: '#636360', fontStyle: 'italic' },
  { tag: tags.string, color: '#C3E88D' },
  { tag: tags.number, color: '#FFB074' },
  { tag: tags.bool, color: '#FFB074' },
  { tag: tags.null, color: '#FFB074' },
  { tag: tags.function(tags.variableName), color: '#92BAFF' },
  { tag: tags.definition(tags.variableName), color: '#92BAFF' },
  { tag: tags.typeName, color: '#92BAFF' },
  { tag: tags.className, color: '#FFCB6B' },
  { tag: tags.operator, color: '#9CDCFE' },
  { tag: tags.punctuation, color: '#9CDCFE' },
  { tag: tags.bracket, color: '#B0B0AE' },
  { tag: tags.propertyName, color: '#F0F0EE' },
  { tag: tags.variableName, color: '#E8E8E6' },
  { tag: tags.self, color: '#FF6B8A' },
  { tag: tags.special(tags.variableName), color: '#FFB074' },
  { tag: tags.meta, color: '#7A7A78' },
]);

// ── THETA172 LIGHT THEME ──────────────────────────────────────
const theta172Light = EditorView.theme({
  '&': {
    backgroundColor: '#FAFAF9',
    color: '#1A1A18',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: '15px',
  },
  '.cm-content': {
    caretColor: '#FF2D00',
    lineHeight: '25px',
    letterSpacing: '0.2px',
    padding: '20px 0 60px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#FF2D00',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#FF2D0040 !important',
  },
  '& .cm-line ::selection': {
    backgroundColor: '#FF2D0040 !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#F0F0EE',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#F0F0EE',
    color: '#7A7A78',
  },
  '.cm-gutters': {
    backgroundColor: '#FAFAF9',
    color: '#C8C8C6',
    border: 'none',
    minWidth: '3em',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(255,45,0,0.1)',
    outline: '1px solid rgba(255,45,0,0.3)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255,45,0,0.2)',
  },
  '.cm-tooltip': {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E0E0DE',
    color: '#1A1A18',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(255,45,0,0.08)',
  },
  '.cm-panels': {
    backgroundColor: '#F5F5F3',
    color: '#1A1A18',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid #E0E0DE',
  },
  '.cm-textfield': {
    backgroundColor: '#FFFFFF',
    border: '1px solid #D0D0CE',
    color: '#1A1A18',
  },
  '.cm-button': {
    backgroundColor: '#FFFFFF',
    border: '1px solid #D0D0CE',
    color: '#1A1A18',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    scrollbarWidth: 'thin',
    scrollbarColor: '#C8C8C640 transparent',
  },
}, { dark: false });

const theta172LightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#C41E00', fontWeight: 'bold' },
  { tag: tags.comment, color: '#9E9E9C', fontStyle: 'italic' },
  { tag: tags.string, color: '#2D8B47' },
  { tag: tags.number, color: '#C44D00' },
  { tag: tags.bool, color: '#C44D00' },
  { tag: tags.null, color: '#C44D00' },
  { tag: tags.function(tags.variableName), color: '#1565C0' },
  { tag: tags.definition(tags.variableName), color: '#1565C0' },
  { tag: tags.typeName, color: '#1565C0' },
  { tag: tags.className, color: '#1565C0' },
  { tag: tags.operator, color: '#5C6BC0' },
  { tag: tags.punctuation, color: '#5C6BC0' },
  { tag: tags.bracket, color: '#5C6BC0' },
  { tag: tags.propertyName, color: '#1A1A18' },
  { tag: tags.variableName, color: '#1A1A18' },
  { tag: tags.self, color: '#C41E00' },
  { tag: tags.special(tags.variableName), color: '#C44D00' },
  { tag: tags.meta, color: '#9E9E9C' },
]);

// ── Starter Code ──────────────────────────────────────────────
export const STARTER_CODE = `# Welcome to Python by THETA172
# Press Ctrl+Enter to run  ·  Ctrl+Shift+P for commands

def greet(name: str) -> str:
    return f"Hello, {name}! Welcome to THETA172."

name = input("Enter your name: ")
print(greet(name))
print()

# Fibonacci sequence
def fibonacci(n: int) -> list[int]:
    a, b, result = 0, 1, []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result

count = int(input("How many Fibonacci numbers? "))
nums = fibonacci(count)
print(f"Fibonacci({count}): {nums}")
`;

// ── State ─────────────────────────────────────────────────────
let currentTheme = 'dark';
let editorView = null;

// ── Font size extension ───────────────────────────────────────
function fontSizeTheme(size) {
  return EditorView.theme({
    '&': { fontSize: size + 'px' },
    '.cm-content': { lineHeight: Math.round(size * 1.64) + 'px' },
  });
}

// ── Create Editor ─────────────────────────────────────────────
export async function createEditor(container) {
  const extensions = [
    // Core
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),

    // Keymaps
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),

    // Language
    python(),

    // Error line highlighting
    errorLineField,

    // Theme (dynamic via compartment)
    themeCompartment.of([
      theta172Dark,
      syntaxHighlighting(theta172DarkHighlight),
    ]),

    // Font size (dynamic via compartment)
    fontSizeCompartment.of(fontSizeTheme(15)),

    // Smooth scrolling
    EditorView.theme({
      '.cm-scroller': { scrollBehavior: 'smooth' },
    }),

    // Scrollbar overview (minimap-like gutter marks for errors)
    EditorView.theme({
      '&': { position: 'relative' },
      '.cm-scroller': {
        '&::-webkit-scrollbar': { width: '10px' },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(128,128,128,0.3)',
          borderRadius: '0',
        },
      },
    }),
  ];

  editorView = new EditorView({
    state: EditorState.create({
      doc: STARTER_CODE,
      extensions,
    }),
    parent: container,
  });

  // Resize on window resize
  window.addEventListener('resize', () => editorView?.requestMeasure());

  return editorView;
}

/**
 * Get the full EditorState (for tab switching — preserves undo history).
 * Returns the CM6 EditorState object directly.
 */
export function getEditorState() {
  return editorView?.state ?? null;
}

/**
 * Replace the editor state entirely (for tab switching).
 * Accepts an EditorState object or a plain string.
 */
export function setEditorState(stateOrDoc) {
  if (!editorView) return;

  if (typeof stateOrDoc === 'string') {
    // Simple string — create fresh state (no undo history)
    setValue(stateOrDoc);
    return;
  }

  // Full EditorState — swap it in to preserve undo
  editorView.setState(stateOrDoc);
}

// ── Editor API (compatible interface) ─────────────────────────

/** Get current editor content */
export function getValue() {
  return editorView?.state.doc.toString() ?? '';
}

/** Set editor content */
export function setValue(code) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: code },
  });
}

/** Focus the editor */
export function focusEditor() {
  editorView?.focus();
}

/** Update font size */
export function setFontSize(size) {
  if (!editorView) return;
  editorView.dispatch({
    effects: fontSizeCompartment.reconfigure(fontSizeTheme(size)),
  });
}

/** Get cursor position */
export function getCursorPosition() {
  if (!editorView) return { lineNumber: 1, column: 1 };
  const pos = editorView.state.selection.main.head;
  const line = editorView.state.doc.lineAt(pos);
  return { lineNumber: line.number, column: pos - line.from + 1 };
}

/** Get line count */
export function getLineCount() {
  return editorView?.state.doc.lines ?? 0;
}

/** Get character count */
export function getCharCount() {
  return editorView?.state.doc.length ?? 0;
}

/** Register callback for content changes */
export function onContentChange(callback) {
  // Returns an extension — must be called before createEditor or added dynamically
  return EditorView.updateListener.of((update) => {
    if (update.docChanged) callback(update);
  });
}

/** Register callback for cursor changes */
export function onCursorChange(callback) {
  return EditorView.updateListener.of((update) => {
    if (update.selectionSet || update.docChanged) {
      callback(getCursorPosition());
    }
  });
}

/** Layout / measure (equivalent to Monaco's layout()) */
export function layout() {
  editorView?.requestMeasure();
}

/** Get the raw EditorView instance */
export function getView() {
  return editorView;
}

/**
 * Toggle editor theme between light and dark.
 * Returns the new theme name.
 */
export function toggleEditorTheme() {
  if (!editorView) return currentTheme;
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';

  const themeExt = currentTheme === 'light'
    ? [theta172Light, syntaxHighlighting(theta172LightHighlight)]
    : [theta172Dark, syntaxHighlighting(theta172DarkHighlight)];

  editorView.dispatch({
    effects: themeCompartment.reconfigure(themeExt),
  });

  return currentTheme;
}

export function getEditorTheme() {
  return currentTheme;
}

// ── Error Line Highlighting ───────────────────────────────────
import { Decoration, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect, RangeSet } from '@codemirror/state';

const addErrorLine = StateEffect.define();
const clearErrors = StateEffect.define();

const errorLineField = StateField.define({
  create() { return Decoration.none; },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(clearErrors)) {
        decorations = Decoration.none;
      }
      if (effect.is(addErrorLine)) {
        const line = tr.state.doc.line(effect.value);
        const deco = Decoration.line({
          class: 'cm-error-line',
        }).range(line.from);
        decorations = decorations.update({ add: [deco] });
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

/** Highlight a specific line number as an error */
export function highlightErrorLine(lineNum) {
  if (!editorView) return;
  const maxLine = editorView.state.doc.lines;
  if (lineNum < 1 || lineNum > maxLine) return;

  editorView.dispatch({
    effects: addErrorLine.of(lineNum),
  });
}

/** Clear all error highlights */
export function clearErrorHighlights() {
  if (!editorView) return;
  editorView.dispatch({
    effects: clearErrors.of(null),
  });
}

/** Jump to a specific line number */
export function gotoLine(lineNum) {
  if (!editorView) return;
  const maxLine = editorView.state.doc.lines;
  if (lineNum < 1 || lineNum > maxLine) return;

  const line = editorView.state.doc.line(lineNum);
  editorView.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true,
  });
  editorView.focus();
}

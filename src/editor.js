/**
 * THETA172 — CodeMirror 6 Editor Module
 * Dual theme: Light (white surface) / Dark (black surface).
 * Smooth caret, bracket matching, Python language support.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter,
         highlightSpecialChars, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor,
         highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment, StateEffect } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentOnInput, bracketMatching,
         foldGutter, foldKeymap, defaultHighlightStyle,
         HighlightStyle, syntaxTree } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';

// ── Compartments for dynamic reconfiguration ──────────────────
const themeCompartment = new Compartment();
const fontSizeCompartment = new Compartment();

// ── Python IntelliSense ───────────────────────────────────────

const PYTHON_BUILTINS = [
  'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray',
  'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
  'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec',
  'filter', 'float', 'format', 'frozenset', 'getattr', 'globals',
  'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
  'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max',
  'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow',
  'print', 'property', 'range', 'repr', 'reversed', 'round', 'set',
  'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super',
  'tuple', 'type', 'vars', 'zip',
];

const PYTHON_KEYWORDS = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield',
];

const PYTHON_DUNDER = [
  '__init__', '__str__', '__repr__', '__len__', '__getitem__', '__setitem__',
  '__delitem__', '__iter__', '__next__', '__contains__', '__call__',
  '__enter__', '__exit__', '__add__', '__sub__', '__mul__', '__truediv__',
  '__eq__', '__ne__', '__lt__', '__gt__', '__le__', '__ge__', '__hash__',
  '__bool__', '__getattr__', '__setattr__', '__delattr__', '__doc__',
  '__name__', '__class__', '__dict__', '__module__', '__file__',
];

const PYTHON_MODULES = [
  'os', 'sys', 'math', 'random', 'json', 'datetime', 'collections',
  'itertools', 'functools', 'typing', 're', 'pathlib', 'io',
  'time', 'string', 'copy', 'abc', 'dataclasses', 'enum',
];

const STR_METHODS = [
  'capitalize', 'casefold', 'center', 'count', 'encode', 'endswith',
  'expandtabs', 'find', 'format', 'index', 'isalnum', 'isalpha',
  'isdigit', 'islower', 'isnumeric', 'isspace', 'istitle', 'isupper',
  'join', 'ljust', 'lower', 'lstrip', 'replace', 'rfind', 'rjust',
  'rstrip', 'split', 'splitlines', 'startswith', 'strip', 'title',
  'upper', 'zfill',
];

const LIST_METHODS = [
  'append', 'clear', 'copy', 'count', 'extend', 'index', 'insert',
  'pop', 'remove', 'reverse', 'sort',
];

const DICT_METHODS = [
  'clear', 'copy', 'fromkeys', 'get', 'items', 'keys', 'pop',
  'popitem', 'setdefault', 'update', 'values',
];

function extractUserSymbols(doc) {
  const text = doc.toString();
  const symbols = new Set();

  // Match def/class declarations
  for (const m of text.matchAll(/(?:def|class)\s+(\w+)/g)) {
    symbols.add(m[1]);
  }
  // Match variable assignments
  for (const m of text.matchAll(/^\s*(\w+)\s*=/gm)) {
    if (!PYTHON_KEYWORDS.includes(m[1])) symbols.add(m[1]);
  }
  // Match import names
  for (const m of text.matchAll(/import\s+(\w+)/g)) {
    symbols.add(m[1]);
  }
  // Match for-loop variables
  for (const m of text.matchAll(/for\s+(\w+)\s+in/g)) {
    symbols.add(m[1]);
  }
  // Match function parameters
  for (const m of text.matchAll(/def\s+\w+\(([^)]+)\)/g)) {
    for (const p of m[1].split(',')) {
      const name = p.trim().split(/[=:]/)[0].trim();
      if (name && /^\w+$/.test(name) && name !== 'self') symbols.add(name);
    }
  }

  return [...symbols];
}

function pythonIntelliSense(context) {
  const before = context.matchBefore(/[\w.]*/)
  if (!before || (before.from === before.to && !context.explicit)) return null;

  const text = before.text;

  // Dot completions (method suggestions)
  if (text.includes('.')) {
    const parts = text.split('.');
    const prefix = parts[parts.length - 1];
    const obj = parts.slice(0, -1).join('.');

    let methods = [];
    // Guess the type from common patterns
    const line = context.state.doc.lineAt(before.from).text;
    if (/\bstr\b|['"]/.test(line) || /\.(?:upper|lower|strip|split)/.test(line)) {
      methods = STR_METHODS;
    } else if (/\blist\b|\[/.test(line) || /\.(?:append|extend|pop)/.test(line)) {
      methods = LIST_METHODS;
    } else if (/\bdict\b|\{/.test(line) || /\.(?:keys|values|items)/.test(line)) {
      methods = DICT_METHODS;
    } else {
      methods = [...STR_METHODS, ...LIST_METHODS, ...DICT_METHODS];
    }

    const from = before.from + text.lastIndexOf('.') + 1;
    return {
      from,
      options: methods
        .filter(m => m.startsWith(prefix))
        .map(m => ({ label: m, type: 'method', boost: 1 })),
    };
  }

  // Regular completions
  const userSymbols = extractUserSymbols(context.state.doc);
  const options = [
    ...PYTHON_KEYWORDS.map(k => ({ label: k, type: 'keyword', boost: -1 })),
    ...PYTHON_BUILTINS.map(b => ({ label: b, type: 'function', boost: 2 })),
    ...PYTHON_DUNDER.map(d => ({ label: d, type: 'property', boost: -2 })),
    ...PYTHON_MODULES.map(m => ({ label: m, type: 'namespace', boost: 0 })),
    ...userSymbols.map(s => ({ label: s, type: 'variable', boost: 3 })),
  ];

  return {
    from: before.from,
    options,
    validFor: /^\w*$/,
  };
}

// ── Real-time Python Syntax Linter ────────────────────────────
const pythonLinter = linter((view) => {
  const diagnostics = [];
  const doc = view.state.doc;
  const text = doc.toString();
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const lineObj = doc.line(i + 1);

    // Only flag unmatched closing brackets (no opener on same line)
    let parens = 0, brackets = 0, braces = 0;
    let inStr = false, strChar = '', tripleStr = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      const c3 = line.slice(j, j + 3);

      // Handle triple-quoted strings
      if (tripleStr) {
        if (c3 === strChar) { tripleStr = false; j += 2; }
        continue;
      }
      if (c3 === '"""' || c3 === "'''") {
        tripleStr = true; strChar = c3; j += 2; continue;
      }

      if (inStr) {
        if (c === strChar && line[j-1] !== '\\') inStr = false;
        continue;
      }
      if ((c === '"' || c === "'") && line[j-1] !== '\\') {
        inStr = true; strChar = c; continue;
      }

      if (c === '#') break; // Rest is comment

      if (c === '(') parens++;
      if (c === ')') parens--;
      if (c === '[') brackets++;
      if (c === ']') brackets--;
      if (c === '{') braces++;
      if (c === '}') braces--;

      if (parens < -1 || brackets < -1 || braces < -1) {
        diagnostics.push({
          from: lineObj.from + j,
          to: lineObj.from + j + 1,
          severity: 'error',
          message: `Unmatched closing '${c}'`,
        });
        break;
      }
    }
  }

  return diagnostics;
}, { delay: 800 });

// ── THETA172 DARK THEME ───────────────────────────────────────
const theta172Dark = EditorView.theme({
  '&': {
    backgroundColor: '#111111',
    color: '#E8E8E6',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  },
  '.cm-content': {
    caretColor: '#FF2D00',
    lineHeight: '25px',
    letterSpacing: '0.2px',
    padding: '20px 0 60px 0',
    contain: 'content',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#FF2D00',
    borderLeftWidth: '2px',
    transition: 'left 60ms cubic-bezier(0.22, 1, 0.36, 1), top 60ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#FF2D0055 !important',
  },
  '& .cm-line ::selection': {
    backgroundColor: '#FF2D0055 !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#1A1A18',
    transition: 'background-color 120ms ease',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#1A1A18',
    color: '#AAAAAA',
    transition: 'background-color 120ms ease, color 120ms ease',
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
    transition: 'background-color 150ms ease, outline-color 150ms ease',
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
    animation: 'cmTooltipIn 150ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(255,45,0,0.15)',
    transition: 'background-color 80ms ease',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    transition: 'background-color 80ms ease',
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
    transition: 'border-color 150ms ease',
  },
  '.cm-textfield:focus': {
    borderColor: '#FF2D00',
  },
  '.cm-button': {
    backgroundColor: '#1A1A18',
    border: '1px solid #2E2E2C',
    color: '#EAEAE8',
    transition: 'background-color 150ms ease, border-color 150ms ease',
  },
  '.cm-button:hover': {
    backgroundColor: '#2E2E2C',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    scrollBehavior: 'smooth',
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
  },
  '.cm-content': {
    caretColor: '#FF2D00',
    lineHeight: '25px',
    letterSpacing: '0.2px',
    padding: '20px 0 60px 0',
    contain: 'content',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#FF2D00',
    borderLeftWidth: '2px',
    transition: 'left 60ms cubic-bezier(0.22, 1, 0.36, 1), top 60ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#FF2D0040 !important',
  },
  '& .cm-line ::selection': {
    backgroundColor: '#FF2D0040 !important',
  },
  '.cm-activeLine': {
    backgroundColor: '#F0F0EE',
    transition: 'background-color 120ms ease',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#F0F0EE',
    color: '#7A7A78',
    transition: 'background-color 120ms ease, color 120ms ease',
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
    transition: 'background-color 150ms ease, outline-color 150ms ease',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255,45,0,0.2)',
  },
  '.cm-tooltip': {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E0E0DE',
    color: '#1A1A18',
    animation: 'cmTooltipIn 150ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(255,45,0,0.08)',
    transition: 'background-color 80ms ease',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    transition: 'background-color 80ms ease',
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
    transition: 'border-color 150ms ease',
  },
  '.cm-textfield:focus': {
    borderColor: '#FF2D00',
  },
  '.cm-button': {
    backgroundColor: '#FFFFFF',
    border: '1px solid #D0D0CE',
    color: '#1A1A18',
    transition: 'background-color 150ms ease, border-color 150ms ease',
  },
  '.cm-button:hover': {
    backgroundColor: '#F0F0EE',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    scrollBehavior: 'smooth',
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
    autocompletion({
      override: [pythonIntelliSense],
      activateOnTyping: true,
      maxRenderedOptions: 30,
    }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),

    // Real-time linting
    pythonLinter,
    lintGutter(),

    // Find & Replace
    search({ top: true }),

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

    // Lint diagnostic styling
    EditorView.theme({
      '.cm-lint-marker-error': { content: '"●"', color: '#FF4444' },
      '.cm-lint-marker-warning': { content: '"●"', color: '#FFB74D' },
      '.cm-diagnostic-error': { borderLeft: '3px solid #FF4444', paddingLeft: '8px', color: '#FF6666' },
      '.cm-diagnostic-warning': { borderLeft: '3px solid #FFB74D', paddingLeft: '8px', color: '#FFB74D' },
      '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'wavy underline #FF4444' },
      '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'wavy underline #FFB74D' },
    }),

    // Scrollbar overview
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

/** Register callback for content changes (post-creation) */
export function onContentChange(callback) {
  if (!editorView) return;
  editorView.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callback(update);
      })
    ),
  });
}

/** Register callback for cursor changes (post-creation) */
export function onCursorChange(callback) {
  if (!editorView) return;
  editorView.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          callback(getCursorPosition());
        }
      })
    ),
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

/** Open the built-in Find & Replace panel */
export function openFindReplace() {
  if (!editorView) return;
  openSearchPanel(editorView);
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
import { StateField, RangeSet } from '@codemirror/state';

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

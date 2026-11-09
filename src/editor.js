/**
 * THETA172 — CodeMirror 6 Editor Module
 * Colours: the Playground or Pro dark palette, or a light palette for projectors.
 * Smooth caret, bracket matching, Python language support.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLineGutter,
         highlightSpecialChars, drawSelection, dropCursor,
         rectangularSelection, crosshairCursor,
         highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment, StateEffect, Annotation } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, indentOnInput, bracketMatching,
         foldGutter, foldKeymap, indentUnit,
         HighlightStyle } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { linter, lintGutter } from '@codemirror/lint';
import { tags } from '@lezer/highlight';
import { debugEditorExtension } from './debug-editor.js';
import { gitGutterExtension } from './git-gutter.js';

// ── Compartments for dynamic reconfiguration ──────────────────
const themeCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
const wrapCompartment = new Compartment();
const tabSizeCompartment = new Compartment();
// Language intelligence: the built-in helpers (browser) or the language server (desktop)
const assistCompartment = new Compartment();
// The language server plugin for the visible file (its URI changes with the tab)
const lspCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

/** Marks edits the app makes itself (opening a file, switching tabs), not the user. */
const programmatic = Annotation.define();
/** Marks edits copied between the two halves of the split editor. */
const splitSync = Annotation.define();

// Current view settings, re-applied to every tab's state and to the split view
const viewConfig = { fontSize: 15, wrap: false, tabSize: 4, assist: 'basic' };

function wrapExt() { return viewConfig.wrap ? EditorView.lineWrapping : []; }
function tabSizeExt() { return [EditorState.tabSize.of(viewConfig.tabSize), indentUnit.of(' '.repeat(viewConfig.tabSize))]; }

/** Effects that bring any editor state up to the current theme and settings. */
function currentConfigEffects() {
  return [
    themeCompartment.reconfigure(editorThemeExtensions()),
    fontSizeCompartment.reconfigure(fontSizeTheme(viewConfig.fontSize)),
    wrapCompartment.reconfigure(wrapExt()),
    tabSizeCompartment.reconfigure(tabSizeExt()),
    assistCompartment.reconfigure(assistExt()),
  ];
}

/**
 * basic: keyword/import completions and a bracket checker (browser runtime).
 * lsp:   completions and diagnostics come from the language server; the
 *        server's editor extensions arrive through lspCompartment.
 */
function assistExt() {
  if (viewConfig.assist === 'lsp') {
    return autocompletion({ activateOnTyping: true, maxRenderedOptions: 60, icons: true });
  }
  return [
    autocompletion({ override: [pythonIntelliSense], activateOnTyping: true, maxRenderedOptions: 30 }),
    pythonLinter,
  ];
}

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

// ── THETA172 BLACKOUT THEMES ──────────────────────────────────
// Dark follows the approved Blackout design: black surface, red keywords,
// bold white names, grey comments. Light is for classroom projectors.
// Every text colour passes 4.5:1 on its background (tests/contrast.test.js).
function blackoutTheme(c, dark) {
  return EditorView.theme({
    '&': { backgroundColor: c.bg, color: c.text, fontFamily: '"JetBrains Mono", Consolas, monospace' },
    '.cm-content': { caretColor: c.caret, lineHeight: '26px', padding: '16px 0 60px 0', contain: 'content' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.caret, borderLeftWidth: '2px' },
    '.cm-activeLine': { backgroundColor: c.activeLine },
    '.cm-activeLineGutter': { backgroundColor: c.activeLine, color: c.text },
    '.cm-gutters': { backgroundColor: c.bg, color: c.gutter, border: 'none', minWidth: '3.4em' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 14px 0 16px' },
    '.cm-foldGutter': { color: c.gutter },
    '.cm-matchingBracket': { backgroundColor: c.bracketBg, outline: `1px solid ${c.caret}` },
    '.cm-searchMatch': { backgroundColor: c.searchBg, outline: `1px solid ${c.caret}` },
    '.cm-selectionMatch': { backgroundColor: c.selectionMatch },
    '.cm-tooltip': { backgroundColor: c.surface, border: `1px solid ${c.border}`, color: c.text },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: c.selected, color: c.text },
    '.cm-panels': { backgroundColor: c.surface, color: c.text },
    '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${c.border}` },
    '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${c.border}` },
    '.cm-textfield': { backgroundColor: c.bg, border: `1px solid ${c.border}`, color: c.text },
    '.cm-textfield:focus': { borderColor: c.caret, outline: 'none' },
    '.cm-button': { backgroundColor: 'transparent', border: `1px solid ${c.border}`, color: c.text },
    '.cm-button:hover': { backgroundColor: c.selected },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: `${c.scroll} transparent` },
  }, { dark });
}

// Playground: the dark editor tile (ink) from the approved Round 5 design
const playgroundDark = blackoutTheme({
  bg: '#17142E', text: '#ECEAFF', caret: '#C6F24E', activeLine: '#221E44', gutter: '#9D97D3',
  bracketBg: 'rgba(198,242,78,0.18)', searchBg: 'rgba(255,74,54,0.3)', selectionMatch: 'rgba(255,255,255,0.08)',
  surface: '#221E44', border: '#4A4380', selected: '#2E2858', scroll: '#3A3470',
}, true);

const playgroundHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: '#FF7A68' },
  { tag: tags.comment, color: '#A9A3D6', fontStyle: 'italic' },
  { tag: tags.string, color: '#CDBEFF' },
  { tag: [tags.number, tags.bool, tags.null], color: '#C6F24E' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#FFFFFF', fontWeight: '600' },
  { tag: tags.definition(tags.variableName), color: '#FFFFFF', fontWeight: '600' },
  { tag: [tags.className, tags.definition(tags.className), tags.typeName], color: '#9FD8FF', fontWeight: '600' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#B9B3E6' },
  { tag: tags.propertyName, color: '#ECEAFF' },
  { tag: tags.variableName, color: '#ECEAFF' },
  { tag: tags.self, color: '#FFB3D9', fontStyle: 'italic' },
  { tag: tags.special(tags.variableName), color: '#FFD84A' },
  { tag: tags.meta, color: '#FFD84A' },
  { tag: tags.invalid, color: '#FF7A68', textDecoration: 'underline' },
]);

// Pro: graphite, from the approved Round 4 design
const proDark = blackoutTheme({
  bg: '#0E0F11', text: '#E7E8EB', caret: '#FF4A36', activeLine: '#16181C', gutter: '#868A93',
  bracketBg: 'rgba(110,168,254,0.18)', searchBg: 'rgba(242,166,90,0.28)', selectionMatch: 'rgba(255,255,255,0.07)',
  surface: '#1B1D21', border: '#3B3F47', selected: '#23252A', scroll: '#2A2D33',
}, true);

const proHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: '#FF7A68' },
  { tag: tags.comment, color: '#8C909A', fontStyle: 'italic' },
  { tag: tags.string, color: '#F2A65A' },
  { tag: [tags.number, tags.bool, tags.null], color: '#B39DFF' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#6EA8FE' },
  { tag: tags.definition(tags.variableName), color: '#6EA8FE' },
  { tag: [tags.className, tags.definition(tags.className), tags.typeName], color: '#4FC6AE' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#B3B6BE' },
  { tag: tags.propertyName, color: '#E7E8EB' },
  { tag: tags.variableName, color: '#E7E8EB' },
  { tag: tags.self, color: '#B39DFF', fontStyle: 'italic' },
  { tag: tags.special(tags.variableName), color: '#E8B04E' },
  { tag: tags.meta, color: '#E8B04E' },
  { tag: tags.invalid, color: '#FF7A68', textDecoration: 'underline' },
]);

const theta172Light = blackoutTheme({
  bg: '#FFFFFF', text: '#1A1A1A', caret: '#C2271A', activeLine: '#F2F2F0', gutter: '#767676',
  bracketBg: 'rgba(194,39,26,0.12)', searchBg: 'rgba(194,39,26,0.2)', selectionMatch: 'rgba(0,0,0,0.06)',
  surface: '#F5F5F3', border: '#8A8A8A', selected: '#E2E2E0', scroll: '#BDBDBD',
}, false);

const theta172LightHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#C2271A' },
  { tag: [tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: '#C2271A' },
  { tag: tags.comment, color: '#6B6B6B' },
  { tag: tags.string, color: '#3D3D3D', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null], color: '#A3200F' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#000000', fontWeight: '700' },
  { tag: tags.definition(tags.variableName), color: '#000000', fontWeight: '700' },
  { tag: [tags.className, tags.definition(tags.className), tags.typeName], color: '#000000', fontWeight: '700' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: '#555555' },
  { tag: tags.propertyName, color: '#1A1A1A' },
  { tag: tags.variableName, color: '#1A1A1A' },
  { tag: tags.self, color: '#A3200F', fontStyle: 'italic' },
  { tag: tags.special(tags.variableName), color: '#A3200F' },
  { tag: tags.meta, color: '#A3200F' },
  { tag: tags.invalid, color: '#C2271A', textDecoration: 'underline' },
]);

/** The dark code colours of the active app theme, for other code views (classroom). */
export function currentCodeTheme() {
  return appTheme === 'pro'
    ? [proDark, syntaxHighlighting(proHighlight)]
    : [playgroundDark, syntaxHighlighting(playgroundHighlight)];
}

function editorThemeExtensions() {
  return currentTheme === 'light'
    ? [theta172Light, syntaxHighlighting(theta172LightHighlight)]
    : currentCodeTheme();
}

/**
 * Extensions for a read-only code viewer (the diff view): same theme, font
 * size and Python highlighting as the editor.
 */
export function viewerExtensions() {
  return [
    lineNumbers(), highlightSpecialChars(), python(), EditorState.readOnly.of(true), EditorView.editable.of(false),
    editorThemeExtensions(), fontSizeTheme(viewConfig.fontSize), tabSizeExt(),
  ];
}

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
let currentTheme = 'dark'; // 'dark' (theme colours) or 'light' (projectors)
let appTheme = document.documentElement.dataset.theme === 'pro' ? 'pro' : 'playground';
/*
 * Editor groups: views[0] is the left group, views[1] the right one (when
 * open). editorView is always the focused group's view, so every function
 * below acts on the group the user is working in.
 */
const views = [null, null];
let activeGroup = 0;
let editorView = null;
let baseExtensions = [];
const extraExtensions = []; // listeners added after creation (they go into every new state)
let mirrorOn = false; // both groups show the same file: copy edits across
const groupListeners = new Set();

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
    // Core (the breakpoint gutter sits left of the line numbers, as in VS Code)
    debugEditorExtension,
    lineNumbers(),
    gitGutterExtension,
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
    assistCompartment.of(assistExt()),
    lspCompartment.of([]),
    readOnlyCompartment.of([]),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),

    // Diagnostics gutter (from the bracket checker or the language server)
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
    themeCompartment.of(editorThemeExtensions()),

    // Font size, word wrap and tab size (dynamic via compartments)
    fontSizeCompartment.of(fontSizeTheme(15)),
    wrapCompartment.of(wrapExt()),
    tabSizeCompartment.of(tabSizeExt()),

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

  baseExtensions = extensions;
  views[0] = new EditorView({
    state: EditorState.create({ doc: STARTER_CODE, extensions }),
    parent: container,
    dispatchTransactions: mirrorDispatch(0),
  });
  followFocus(0);
  editorView = views[0];

  // Resize on window resize
  window.addEventListener('resize', () => views.forEach((v) => v?.requestMeasure()));

  return editorView;
}

/** Copy edits to the other group when it shows the same file. */
function mirrorDispatch(g) {
  return (trs, view) => {
    view.update(trs);
    const other = views[1 - g];
    if (!mirrorOn || !other) return;
    for (const tr of trs) {
      if (!tr.changes.empty && !tr.annotation(splitSync)) {
        // A load by the app stays a load in the other group too (not an unsaved edit)
        const marks = [splitSync.of(true)];
        if (tr.annotation(programmatic)) marks.push(programmatic.of(true));
        other.dispatch({ changes: tr.changes, annotations: marks });
      }
    }
  };
}

function followFocus(g) {
  views[g].dom.addEventListener('focusin', () => setActiveGroup(g));
}

/** A new editor state with the editor's full configuration (a fresh tab: no shared undo history). */
export function freshState(doc = '') {
  return EditorState.create({ doc, extensions: [...baseExtensions, ...extraExtensions] });
}

/** Make group `g` the one every editor function acts on. */
export function setActiveGroup(g) {
  if (!views[g] || g === activeGroup && editorView === views[g]) return;
  activeGroup = g;
  editorView = views[g];
  groupListeners.forEach((fn) => fn(g));
}

export const getActiveGroup = () => activeGroup;
export const getGroupView = (g) => views[g];
/** fn(group) when the focused group changes. */
export function onActiveGroupChange(fn) { groupListeners.add(fn); return () => groupListeners.delete(fn); }

/** Both groups show the same file: keep their text identical. */
export function setMirror(on) { mirrorOn = !!on; }

/** Open the right-hand group in `container` with `state`. */
export function openGroupView(container, state) {
  if (views[1]) return views[1];
  views[1] = new EditorView({ state, parent: container, dispatchTransactions: mirrorDispatch(1) });
  views[1].dispatch({ effects: currentConfigEffects() });
  followFocus(1);
  return views[1];
}

/** Close the right-hand group (its file stays open in its tab). */
export function closeGroupView() {
  if (!views[1]) return;
  mirrorOn = false;
  if (activeGroup === 1) setActiveGroup(0);
  views[1].destroy();
  views[1] = null;
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

  // Full EditorState — swap it in to preserve undo, then bring it up to the
  // current theme and settings (they may have changed since it was stored)
  editorView.setState(stateOrDoc);
  editorView.dispatch({ effects: currentConfigEffects() });
}

// ── Editor API (compatible interface) ─────────────────────────

/** Get current editor content */
export function getValue() {
  return editorView?.state.doc.toString() ?? '';
}

/** Set editor content as a user edit (examples, reset, AI fix): marks the tab unsaved. */
export function setValue(code) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: code },
  });
}

/** Load content the app opened itself (a file, a tab switch): not an unsaved edit. */
export function loadValue(code) {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: code },
    annotations: programmatic.of(true),
  });
}

/** Switch language intelligence between the built-in helpers and the language server. */
export function setLanguageAssist(mode) {
  viewConfig.assist = mode === 'lsp' ? 'lsp' : 'basic';
  editorView?.dispatch({ effects: assistCompartment.reconfigure(assistExt()) });
}

/** The language server plugin for the visible document ([] for none). */
export function setLspExtension(ext) {
  if (!editorView) return;
  if (lspCompartment.get(editorView.state) === ext) return;
  editorView.dispatch({ effects: lspCompartment.reconfigure(ext) });
}

/** Library files (go to definition) open read-only. */
export function setReadOnly(on) {
  if (!editorView) return;
  const ext = on ? EditorState.readOnly.of(true) : [];
  editorView.dispatch({ effects: readOnlyCompartment.reconfigure(ext) });
}

/** Replace a specific view's text as a load by the app (a file changed on disk). */
export function loadIntoView(view, code) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code }, annotations: programmatic.of(true) });
}

/** Focus the editor */
export function focusEditor() {
  editorView?.focus();
}

/** Update font size (both halves of the split editor) */
export function setFontSize(size) {
  viewConfig.fontSize = size;
  for (const v of views) v?.dispatch({ effects: fontSizeCompartment.reconfigure(fontSizeTheme(size)) });
}

/** Soft-wrap long lines on or off. */
export function setWordWrap(on) {
  viewConfig.wrap = !!on;
  for (const v of views) v?.dispatch({ effects: wrapCompartment.reconfigure(wrapExt()) });
}

/** Spaces per indent level (2 or 4). */
export function setTabSize(n) {
  viewConfig.tabSize = n === 2 ? 2 : 4;
  for (const v of views) v?.dispatch({ effects: tabSizeCompartment.reconfigure(tabSizeExt()) });
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

/**
 * Register callback for content changes (post-creation).
 * The second argument says whether the app made the change itself
 * (loading a file or switching tabs) rather than the user.
 */
export function onContentChange(callback) {
  addListener(EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const byApp = update.transactions.every((tr) => !tr.docChanged || tr.annotation(programmatic));
    callback(update, { programmatic: byApp });
  }));
}

/** Add an extension to every open group now and to every state made later. */
function addListener(ext) {
  extraExtensions.push(ext);
  for (const v of views) v?.dispatch({ effects: StateEffect.appendConfig.of(ext) });
}

/** Register callback for cursor changes (post-creation) */
export function onCursorChange(callback) {
  addListener(EditorView.updateListener.of((update) => {
    if ((update.selectionSet || update.docChanged) && update.view === editorView) callback(getCursorPosition());
  }));
}

/** Layout / measure (equivalent to Monaco's layout()) */
export function layout() {
  views.forEach((v) => v?.requestMeasure());
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

  for (const v of views) v?.dispatch({ effects: themeCompartment.reconfigure(editorThemeExtensions()) });
  return currentTheme;
}

/** Switch the code colours to the Playground or Pro palette. */
export function setAppTheme(name) {
  appTheme = name === 'pro' ? 'pro' : 'playground';
  for (const v of views) v?.dispatch({ effects: themeCompartment.reconfigure(editorThemeExtensions()) });
}

export function getEditorTheme() {
  return currentTheme;
}

// ── Error Line Highlighting ───────────────────────────────────
import { Decoration } from '@codemirror/view';
import { StateField } from '@codemirror/state';

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

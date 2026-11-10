/**
 * Errors, explained in the student's language.
 *
 * A failed run's exception (type + message + the line of the student's
 * code) is matched against rules for the most common Python errors. Each
 * rule pulls the details out of the message (the misspelt name, the missing
 * key, the module …) so the explanation talks about the student's own code:
 *   "'score' is not defined. Did you mean 'scores'? (line 6)"
 * The words come from one table per language (English and Hindi for now). No
 * network and no AI: it works offline in any classroom.
 */
import en from './lang/en.js';
import hi from './lang/hi.js';

export const LANGS = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिंदी' },
];
const TABLES = { en, hi };

const ANY = /^/; // matches every message
const q = "['\"]"; // Python quotes either way
const word = `${q}([^'"]+)${q}`;

/**
 * Rules, most specific first. `re` runs on the exception message;
 * `vars(m, ctx)` turns the match into the words the templates use.
 */
const RULES = [
  { id: 'name', type: 'NameError', re: new RegExp(`name ${word} is not defined`), vars: (m) => ({ name: m[1] }), suggest: 'name' },
  { id: 'unbound', type: 'UnboundLocalError', re: new RegExp(`(?:local variable|cannot access local variable) ${word}`), vars: (m) => ({ name: m[1] }) },
  { id: 'zero', type: 'ZeroDivisionError', re: ANY, vars: () => ({}) },
  { id: 'index', type: 'IndexError', re: /(list|string|tuple|range object) index out of range/, vars: (m) => ({ kind: m[1].replace(' object', '') }) },
  { id: 'index-pop', type: 'IndexError', re: /pop from empty list/, vars: () => ({}) },
  { id: 'key', type: 'KeyError', re: /^(.+)$/, vars: (m) => ({ key: m[1] }) },
  { id: 'concat', type: 'TypeError', re: /can only concatenate (\w+) \(not "(\w+)"\) to (\w+)/, vars: (m) => ({ a: m[1], b: m[2] }) },
  { id: 'operand', type: 'TypeError', re: new RegExp(`unsupported operand type\\(s\\) for ([^:]+): ${word} and ${word}`), vars: (m) => ({ op: m[1].trim(), a: m[2], b: m[3] }) },
  { id: 'compare', type: 'TypeError', re: new RegExp(`${word} not supported between instances of ${word} and ${word}`), vars: (m) => ({ op: m[1], a: m[2], b: m[3] }) },
  { id: 'not-callable', type: 'TypeError', re: new RegExp(`${word} object is not callable`), vars: (m) => ({ obj: m[1] }) },
  { id: 'none-subscript', type: 'TypeError', re: /'NoneType' object is not subscriptable/, vars: () => ({}) },
  { id: 'not-subscriptable', type: 'TypeError', re: new RegExp(`${word} object is not subscriptable`), vars: (m) => ({ obj: m[1] }) },
  { id: 'not-iterable', type: 'TypeError', re: new RegExp(`${word} object is not iterable`), vars: (m) => ({ obj: m[1] }) },
  { id: 'missing-arg', type: 'TypeError', re: new RegExp(`(\\w+)\\(\\) missing (\\d+) required positional arguments?: (.+)$`), vars: (m) => ({ func: m[1], n: m[2], arg: m[3].replace(/['"]/g, '') }) },
  { id: 'too-many-args', type: 'TypeError', re: /(\w+)\(\) takes (\d+) positional arguments? but (\d+) (?:were|was) given/, vars: (m) => ({ func: m[1], expected: m[2], got: m[3] }) },
  { id: 'list-indices', type: 'TypeError', re: new RegExp(`(list|tuple|string) indices must be integers(?: or slices)?, not (\\w+)`), vars: (m) => ({ kind: m[1], got: m[2] }) },
  { id: 'unhashable', type: 'TypeError', re: new RegExp(`unhashable type: ${word}`), vars: (m) => ({ obj: m[1] }) },
  { id: 'str-int', type: 'TypeError', re: /'str' object cannot be interpreted as an integer/, vars: () => ({}) },
  { id: 'int-literal', type: 'ValueError', re: new RegExp(`invalid literal for int\\(\\) with base \\d+: ${q}(.*)${q}`), vars: (m) => ({ text: m[1] }) },
  { id: 'float-convert', type: 'ValueError', re: new RegExp(`could not convert string to float: ${q}(.*)${q}`), vars: (m) => ({ text: m[1] }) },
  { id: 'unpack-many', type: 'ValueError', re: /too many values to unpack \(expected (\d+)/, vars: (m) => ({ expected: m[1] }) },
  { id: 'unpack-few', type: 'ValueError', re: /not enough values to unpack \(expected (\d+), got (\d+)\)/, vars: (m) => ({ expected: m[1], got: m[2] }) },
  { id: 'math-domain', type: 'ValueError', re: /math domain error/, vars: () => ({}) },
  { id: 'none-attr', type: 'AttributeError', re: new RegExp(`'NoneType' object has no attribute ${word}`), vars: (m) => ({ attr: m[1] }) },
  { id: 'attr', type: 'AttributeError', re: new RegExp(`${word} object has no attribute ${word}`), vars: (m) => ({ obj: m[1], attr: m[2] }), suggest: 'attr' },
  { id: 'module-attr', type: 'AttributeError', re: new RegExp(`module ${word} has no attribute ${word}`), vars: (m) => ({ module: m[1], attr: m[2] }) },
  { id: 'no-module', type: 'ModuleNotFoundError', re: new RegExp(`No module named ${word}`), vars: (m) => ({ module: m[1] }) },
  { id: 'import-name', type: 'ImportError', re: new RegExp(`cannot import name ${word}(?: from ${word})?`), vars: (m) => ({ name: m[1], module: m[2] || '' }) },
  { id: 'syntax-colon', type: 'SyntaxError', re: /expected ':'/, vars: () => ({}) },
  { id: 'syntax-unclosed', type: 'SyntaxError', re: new RegExp(`${q}([([{])${q} was never closed`), vars: (m) => ({ bracket: m[1] }) },
  { id: 'syntax-unmatched', type: 'SyntaxError', re: new RegExp(`unmatched ${q}([)\\]}])${q}|closing parenthesis ${q}([)\\]}])${q} does not match`), vars: (m) => ({ bracket: m[1] || m[2] }) },
  { id: 'syntax-string', type: 'SyntaxError', re: /unterminated (?:triple-quoted )?string literal|EOL while scanning string literal/, vars: () => ({}) },
  { id: 'syntax-equals', type: 'SyntaxError', re: /Maybe you meant '==' or ':=' instead of '='|cannot assign to (?:comparison|function call|literal)/, vars: () => ({}) },
  { id: 'syntax-comma', type: 'SyntaxError', re: /Perhaps you forgot a comma/, vars: () => ({}) },
  { id: 'syntax-print', type: 'SyntaxError', re: /Missing parentheses in call to 'print'/, vars: () => ({}) },
  { id: 'indent-expected', type: 'IndentationError', re: /expected an indented block(?: after '?(\w+)'? statement on line (\d+))?/, vars: (m) => ({ stmt: m[1] || '', at: m[2] || '' }) },
  { id: 'indent-unexpected', type: 'IndentationError', re: /unexpected indent/, vars: () => ({}) },
  { id: 'indent-unindent', type: 'IndentationError', re: /unindent does not match/, vars: () => ({}) },
  { id: 'tabs', type: 'TabError', re: ANY, vars: () => ({}) },
  { id: 'recursion', type: 'RecursionError', re: /maximum recursion depth/, vars: () => ({}) },
  { id: 'file-not-found', type: 'FileNotFoundError', re: new RegExp(`No such file or directory: ${word}`), vars: (m) => ({ file: m[1] }) },
  { id: 'eof', type: 'EOFError', re: ANY, vars: () => ({}) },
  { id: 'interrupt', type: 'KeyboardInterrupt', re: ANY, vars: () => ({}) },
  { id: 'assert', type: 'AssertionError', re: ANY, vars: () => ({}) },
  { id: 'overflow', type: 'OverflowError', re: ANY, vars: () => ({}) },
  { id: 'syntax', type: 'SyntaxError', re: ANY, vars: () => ({}) },
];

/** Families for errors without a specific rule. */
const FAMILY = {
  NameError: 'generic-name', TypeError: 'generic-type', ValueError: 'generic-value', IndexError: 'generic-index',
  KeyError: 'generic-key', AttributeError: 'generic-attr', ImportError: 'generic-import', ModuleNotFoundError: 'generic-import',
  SyntaxError: 'syntax', IndentationError: 'indent-unexpected', OSError: 'generic-os', PermissionError: 'generic-os',
};

/** Words in the student's code (names, attributes) to suggest from. */
export function namesIn(code) {
  const clean = String(code || '')
    .replace(/#.*$/gm, '')
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
  return [...new Set(clean.match(/[A-Za-z_]\w*/g) || [])];
}

/** Edit distance (small strings only). */
export function distance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Two neighbouring letters swapped (pritn → print) is one typo
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const PY_NAMES = ['print', 'input', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'sum', 'max', 'min', 'abs', 'round', 'sorted', 'enumerate', 'zip', 'open', 'True', 'False', 'None', 'append', 'upper', 'lower', 'split', 'join', 'strip', 'replace', 'keys', 'values', 'items'];

/** The closest known name to `wrong`, or ''. Python 3.12's own "Did you mean" wins. */
export function suggestName(wrong, message, code) {
  const said = /Did you mean:? ['"]?([\w.]+)['"]?\??/.exec(message || '');
  if (said) return said[1];
  let best = '';
  let bestD = 3;
  for (const n of [...namesIn(code), ...PY_NAMES]) {
    if (n === wrong) continue;
    const dd = n.toLowerCase() === wrong.toLowerCase() ? 0.5 : distance(n, wrong);
    if (dd < bestD && dd <= Math.max(1, Math.floor(wrong.length / 3))) { best = n; bestD = dd; }
  }
  return best;
}

/** Find the rule for an exception: { id, vars }. */
export function matchError({ type, message }, code = '') {
  const msg = String(message || '');
  for (const r of RULES) {
    if (r.type !== type) continue;
    const m = r.re.exec(msg);
    if (!m) continue;
    const vars = r.vars(m);
    if (r.suggest && vars[r.suggest]) vars.suggest = suggestName(vars[r.suggest], msg, code);
    return { id: r.id, vars };
  }
  return { id: FAMILY[type] || 'generic', vars: {} };
}

const fill = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== '' ? vars[k] : `{${k}}`));

/**
 * Explain an error.
 * @param {{ type: string, message: string, line?: number, lineText?: string }} error
 * @param {{ lang?: string, code?: string }} [opts]
 * @returns {{ id, lang, title, why, fix, hint, line, lineText, type, message }}
 */
export function explainError(error, { lang = 'en', code = '' } = {}) {
  if (!error?.type) return null;
  const table = TABLES[lang] || en;
  const { id, vars } = matchError(error, code);
  const all = { ...vars, type: error.type, line: error.line || '?' }; // most sentences mention the line
  const t = table.rules[id] || en.rules[id] || table.rules.generic || en.rules.generic;
  const pick = (k) => {
    const s = t[k] ?? en.rules[id]?.[k];
    if (!s) return '';
    const out = fill(s, all);
    return /\{\w+\}/.test(out) ? '' : out; // a sentence with a missing detail is left out
  };
  return {
    id, lang: TABLES[lang] ? lang : 'en', type: error.type, message: error.message || '',
    title: pick('title') || `${error.type}`,
    why: pick('why'),
    fix: pick('fix'),
    hint: all.suggest ? fill(table.ui.didYouMean || en.ui.didYouMean, all) : '',
    line: error.line || null,
    lineText: error.lineText || '',
  };
}

/** Words for the explanation card in a language. */
export function uiText(lang) {
  return { ...en.ui, ...(TABLES[lang]?.ui || {}) };
}

export const RULE_IDS = [...new Set([...RULES.map((r) => r.id), ...Object.values(FAMILY), 'generic'])];

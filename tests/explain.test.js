import { describe, it, expect } from 'vitest';
import { explainError, matchError, suggestName, namesIn, distance, LANGS, RULE_IDS, uiText } from '../src/learn/explain/errors.js';
import en from '../src/learn/explain/lang/en.js';
import hi from '../src/learn/explain/lang/hi.js';

const CODE = 'scores = [90, 80]\ntotal = 0\nfor s in scores:\n    total += s\nprint(score)\n';

describe('errors explained', () => {
  it('has English and Hindi', () => {
    expect(LANGS.map((l) => l.id)).toEqual(['en', 'hi']);
  });

  it('every rule has a title, a reason and a fix in both languages, with the same placeholders', () => {
    const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const id of RULE_IDS) {
      for (const [name, table] of [['en', en], ['hi', hi]]) {
        const r = table.rules[id];
        expect(r, `${name}:${id}`).toBeTruthy();
        expect(r.title && r.why && r.fix, `${name}:${id}`).toBeTruthy();
      }
      for (const k of ['title', 'why', 'fix']) expect(ph(hi.rules[id][k]), `hi:${id}.${k}`).toBe(ph(en.rules[id][k]));
    }
    expect(Object.keys(hi.ui).sort()).toEqual(Object.keys(en.ui).sort());
  });

  it("uses the student's own names and suggests the right one", () => {
    const e = explainError({ type: 'NameError', message: "name 'score' is not defined. Did you mean: 'scores'?", line: 5, lineText: 'print(score)' }, { code: CODE });
    expect(e.title).toBe("Python doesn't know the name 'score'");
    expect(e.why).toContain('line 5');
    expect(e.hint).toBe("Did you mean 'scores'?");
    const h = explainError({ type: 'NameError', message: "name 'score' is not defined", line: 5 }, { lang: 'hi', code: CODE });
    expect(h.title).toBe("'score' नाम का कोई वेरिएबल नहीं है");
    expect(h.hint).toBe("क्या आपका मतलब 'scores' था?"); // found from the code when Python gives no hint
    expect(h.lang).toBe('hi');
  });

  it('suggests from the code, built-ins, and ignores far-off names', () => {
    expect(suggestName('scroes', '', CODE)).toBe('scores');
    expect(suggestName('pritn', '', '')).toBe('print');
    expect(suggestName('Total', '', CODE)).toBe('total');
    expect(suggestName('zzzzzz', '', CODE)).toBe('');
    expect(namesIn('x = "not_a_name"  # comment_word\ny = x')).toEqual(['x', 'y']);
    expect(distance('kitten', 'sitting')).toBe(3);
  });

  it('matches common Python 3.12 messages to the right rule', () => {
    const cases = [
      [{ type: 'ZeroDivisionError', message: 'division by zero' }, 'zero'],
      [{ type: 'IndexError', message: 'list index out of range' }, 'index', { kind: 'list' }],
      [{ type: 'KeyError', message: "'maths'" }, 'key', { key: "'maths'" }],
      [{ type: 'TypeError', message: 'can only concatenate str (not "int") to str' }, 'concat', { a: 'str', b: 'int' }],
      [{ type: 'TypeError', message: "unsupported operand type(s) for +: 'int' and 'str'" }, 'operand', { op: '+', a: 'int', b: 'str' }],
      [{ type: 'TypeError', message: "'<' not supported between instances of 'str' and 'int'" }, 'compare'],
      [{ type: 'TypeError', message: "'int' object is not callable" }, 'not-callable', { obj: 'int' }],
      [{ type: 'TypeError', message: "'NoneType' object is not subscriptable" }, 'none-subscript'],
      [{ type: 'TypeError', message: "greet() missing 1 required positional argument: 'name'" }, 'missing-arg', { func: 'greet', arg: 'name' }],
      [{ type: 'TypeError', message: 'add() takes 2 positional arguments but 3 were given' }, 'too-many-args', { expected: '2', got: '3' }],
      [{ type: 'TypeError', message: 'list indices must be integers or slices, not str' }, 'list-indices'],
      [{ type: 'ValueError', message: "invalid literal for int() with base 10: 'ten'" }, 'int-literal', { text: 'ten' }],
      [{ type: 'ValueError', message: 'not enough values to unpack (expected 3, got 2)' }, 'unpack-few'],
      [{ type: 'AttributeError', message: "'NoneType' object has no attribute 'append'" }, 'none-attr'],
      [{ type: 'AttributeError', message: "'list' object has no attribute 'push'" }, 'attr', { obj: 'list', attr: 'push' }],
      [{ type: 'ModuleNotFoundError', message: "No module named 'pandas'" }, 'no-module', { module: 'pandas' }],
      [{ type: 'SyntaxError', message: "expected ':'" }, 'syntax-colon'],
      [{ type: 'SyntaxError', message: "'(' was never closed" }, 'syntax-unclosed', { bracket: '(' }],
      [{ type: 'SyntaxError', message: 'unterminated string literal (detected at line 2)' }, 'syntax-string'],
      [{ type: 'SyntaxError', message: "invalid syntax. Maybe you meant '==' or ':=' instead of '='?" }, 'syntax-equals'],
      [{ type: 'SyntaxError', message: 'invalid syntax' }, 'syntax'],
      [{ type: 'IndentationError', message: "expected an indented block after 'for' statement on line 3" }, 'indent-expected', { stmt: 'for' }],
      [{ type: 'IndentationError', message: 'unexpected indent' }, 'indent-unexpected'],
      [{ type: 'RecursionError', message: 'maximum recursion depth exceeded' }, 'recursion'],
      [{ type: 'FileNotFoundError', message: "[Errno 2] No such file or directory: 'data.csv'" }, 'file-not-found', { file: 'data.csv' }],
      [{ type: 'KeyboardInterrupt', message: '' }, 'interrupt'],
      [{ type: 'PermissionError', message: 'denied' }, 'generic-os'],
      [{ type: 'MyOwnError', message: 'boom' }, 'generic'],
    ];
    for (const [err, id, vars] of cases) {
      const m = matchError(err);
      expect(m.id, err.message).toBe(id);
      if (vars) expect(m.vars).toMatchObject(vars);
    }
  });

  it('fills every sentence (no {placeholders} left), in both languages', () => {
    const e = explainError({ type: 'TypeError', message: "unsupported operand type(s) for +: 'int' and 'str'", line: 3 }, { lang: 'hi' });
    for (const k of ['title', 'why', 'fix']) {
      expect(e[k]).toBeTruthy();
      expect(e[k]).not.toMatch(/\{\w+\}/);
    }
    expect(e.why).toContain('लाइन 3');
    // Without a line number the sentence still reads
    const n = explainError({ type: 'ZeroDivisionError', message: 'division by zero' });
    expect(n.why).toContain('line ?');
    // Unknown language falls back to English
    expect(explainError({ type: 'ZeroDivisionError', message: '' }, { lang: 'xx' }).lang).toBe('en');
    expect(uiText('hi').heading).toBe('क्या गलत हुआ');
  });

  it('gives a sensible explanation for any error type', () => {
    const e = explainError({ type: 'StrangeError', message: 'something', line: 9 });
    expect(e.title).toBe('StrangeError');
    expect(e.why).toBe('The program stopped at line 9 with a StrangeError.');
    expect(explainError(null)).toBe(null);
  });
});

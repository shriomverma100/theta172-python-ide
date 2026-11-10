import { describe, it, expect } from 'vitest';
import { detectConcepts, stripCode, conceptLabel } from '../src/learn/concepts.js';
import { emptyMastery, loadMastery, recordRun, levelOf, summarize, reportHtml } from '../src/learn/mastery.js';
import { comparePrediction, outputLines } from '../src/learn/predict.js';
import { createPulse, applyEvent, studentState, summary, commonBug, suggestHelpers, lineHeat, setOnline } from '../src/classroom/pulse.js';

describe('concepts in code', () => {
  it('finds the ideas a program uses', () => {
    const code = [
      'import math',
      'def fact(n):',
      '    if n <= 1:',
      '        return 1',
      '    return n * fact(n - 1)',
      'marks = {"maths": 90}',
      'nums = [x * x for x in range(5)]',
      'for k, v in marks.items():',
      '    print(f"{k}: {v}")',
      'name = input("Name? ")',
      'try:',
      '    open("data.txt")',
      'except OSError:',
      '    pass',
    ].join('\n');
    expect(detectConcepts(code)).toEqual([
      'output', 'input', 'variables', 'arithmetic', 'strings', 'conditions', 'for-loops', 'lists', 'dicts',
      'comprehensions', 'functions', 'recursion', 'exceptions', 'files', 'modules',
    ]);
  });

  it('ignores words inside strings and comments', () => {
    expect(stripCode('print("for i in x: while")  # if x:')).toBe('print("")  ');
    expect(detectConcepts('print("for i in range(3): pass")')).toEqual(['output']);
  });

  it('tells recursion apart from calling another function', () => {
    expect(detectConcepts('def a():\n    return b()\ndef b():\n    return 1\n')).not.toContain('recursion');
    expect(detectConcepts('import pandas as pd\nimport matplotlib.pyplot as plt\n')).toEqual(['modules', 'data', 'plots']);
    expect(conceptLabel('dicts', 'hi')).toBe('डिक्शनरी');
  });
});

describe('mastery map', () => {
  it('grows from real runs and counts fixed errors', () => {
    const m = emptyMastery();
    recordRun(m, { concepts: ['for-loops'], ok: false, errorType: 'NameError', now: 1 });
    recordRun(m, { concepts: ['for-loops'], ok: false, errorType: 'TypeError', now: 2 });
    expect(levelOf(m.concepts['for-loops'])).toBe(1);
    recordRun(m, { concepts: ['for-loops'], ok: true, now: 3, predictedRight: true });
    expect(m.errors.NameError.fixed).toBe(1);
    expect(m.errors.TypeError.fixed).toBe(1);
    expect(levelOf(m.concepts['for-loops'])).toBe(2);
    for (let i = 0; i < 9; i++) recordRun(m, { concepts: ['for-loops'], ok: true, now: 10 + i });
    expect(levelOf(m.concepts['for-loops'])).toBe(4);
    const s = summarize(m);
    expect(s.concepts).toEqual({ 'for-loops': 4 });
    expect(s.fixed.sort()).toEqual(['NameError', 'TypeError']);
    expect(s.predictions).toEqual({ tried: 1, right: 1 });
  });

  it('loads saved maps and survives junk', () => {
    const m = recordRun(emptyMastery(), { concepts: ['lists'], ok: true });
    expect(loadMastery(JSON.stringify(m)).concepts.lists.ok).toBe(1);
    expect(loadMastery('{bad').runs).toBe(0);
    expect(loadMastery('{"v":9}').runs).toBe(0);
  });

  it('exports a printable report that escapes names', () => {
    const m = recordRun(emptyMastery(), { concepts: ['lists'], ok: true });
    const html = reportHtml(m, { name: '<Asha>', lang: 'hi', date: new Date(2026, 10, 10) });
    expect(html).toContain('&lt;Asha&gt;');
    expect(html).not.toContain('<Asha>');
    expect(html).toContain('प्रगति रिपोर्ट');
    expect(html).toContain('लिस्ट');
  });
});

describe('predict then run', () => {
  it('compares line by line and forgives spacing, case and 2.0 vs 2', () => {
    expect(comparePrediction('Hello\n6\n', 'Hello\n6').exact).toBe(true);
    const r = comparePrediction('total:  10.0\nDone', 'Total: 10\ndone\nextra');
    expect(r.rows.map((x) => x.status)).toEqual(['close', 'close', 'extra']);
    expect(r.right).toBe(false);
    expect(r.score).toBeCloseTo(2 / 3);
    expect(comparePrediction('5', '6').rows[0].status).toBe('different');
    expect(outputLines('a  \r\nb\n\n\n')).toEqual(['a', 'b']);
  });
});

describe('class pulse', () => {
  const T = 1_000_000;
  const fail = (type, lineText, line = 3) => ({ type: 'run', ok: false, error: { type, message: 'x', line, lineText } });
  const ok = { type: 'run', ok: true };

  it('sorts students into done, working, stuck and idle', () => {
    const p = createPulse();
    applyEvent(p, 'a', 'Asha', ok, T);
    applyEvent(p, 'b', 'Ravi', fail('NameError', 'print(score)'), T);
    applyEvent(p, 'b', 'Ravi', fail('NameError', 'print(score)'), T + 1000); // two in a row
    applyEvent(p, 'c', 'Meera', { type: 'done', done: true }, T);
    applyEvent(p, 'd', 'Kabir', { type: 'hand', up: true }, T);
    applyEvent(p, 'e', 'Diya', fail('TypeError', 'x + "a"'), T);
    expect(studentState(p.students.get('e'), T + 1000)).toBe('working'); // one failure: still trying
    expect(studentState(p.students.get('e'), T + 4 * 60_000)).toBe('stuck'); // failing for minutes
    expect(summary(p, T + 2000)).toEqual({ done: 1, working: 2, stuck: 2, idle: 0, total: 5 });
    expect(studentState(p.students.get('a'), T + 11 * 60_000)).toBe('idle');
  });

  it('finds the most common bug', () => {
    const p = createPulse();
    applyEvent(p, 'a', 'Asha', fail('NameError', 'print(score)'), T);
    applyEvent(p, 'b', 'Ravi', fail('NameError', 'print(scor)'), T);
    applyEvent(p, 'c', 'Meera', fail('TypeError', 'x'), T);
    const bug = commonBug(p, T);
    expect(bug).toMatchObject({ type: 'NameError', count: 2, names: ['Asha', 'Ravi'] });
  });

  it('suggests a classmate who just fixed the same error', () => {
    const p = createPulse();
    applyEvent(p, 'r', 'Ravi', fail('KeyError', 'd["x"]'), T);
    applyEvent(p, 'r', 'Ravi', ok, T + 60_000);
    applyEvent(p, 'm', 'Meera', fail('KeyError', 'd["y"]'), T);
    applyEvent(p, 'm', 'Meera', ok, T + 120_000);
    applyEvent(p, 'm', 'Meera', { type: 'done', done: true }, T + 130_000);
    applyEvent(p, 'a', 'Asha', fail('KeyError', 'd["z"]'), T + 200_000);
    const helpers = suggestHelpers(p, 'KeyError', 'a', T + 210_000);
    expect(helpers.map((h) => h.name)).toEqual(['Meera', 'Ravi']); // finished first
    setOnline(p, 'm', false);
    expect(suggestHelpers(p, 'KeyError', 'a', T + 210_000).map((h) => h.name)).toEqual(['Ravi']);
    expect(suggestHelpers(p, 'KeyError', 'a', T + 60 * 60_000)).toEqual([]); // too long ago
  });

  it("maps where students are stuck onto the teacher's lines", () => {
    const p = createPulse();
    const teacher = 'scores = [90, 80]\ntotal = 0\nfor s in scores:\n    total += s\nprint(total / len(scores))\n';
    applyEvent(p, 'a', 'Asha', fail('ZeroDivisionError', 'print(total / len(scores))', 6), T);
    applyEvent(p, 'b', 'Ravi', fail('ZeroDivisionError', 'print(total/len(scores))', 5), T);
    applyEvent(p, 'c', 'Meera', fail('NameError', 'for s in scores:', 3), T);
    applyEvent(p, 'd', 'Kabir', fail('NameError', 'something else', 3), T);
    const heat = lineHeat(p, teacher, T);
    expect(heat.get(5)).toMatchObject({ count: 2, names: ['Asha', 'Ravi'] }); // Ravi spaced it differently
    expect(heat.get(3)).toMatchObject({ count: 1, names: ['Meera'] });
    expect([...heat.keys()].sort()).toEqual([3, 5]);
  });
});

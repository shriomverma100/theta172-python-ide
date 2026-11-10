import { describe, it, expect } from 'vitest';
import { Authorship, replayAt, validRecording, describeStats } from '../src/learn/authorship.js';
import { vivaQuestions } from '../src/learn/viva.js';

describe('authorship', () => {
  it('records who wrote what and replays any moment', () => {
    const a = new Authorship('', 1000);
    a.record([{ at: 0, del: 0, ins: 'x = 1\n' }], 't', 1100);
    a.record([{ at: 6, del: 0, ins: 'print(x)\n' }], 'p', 1200);
    a.record([{ at: 4, del: 1, ins: '42' }], 'a', 1300); // AI changed 1 -> 42
    const s = a.stats();
    expect(s.total).toBe('x = 42\nprint(x)\n'.length);
    expect(s.a).toBe(2);
    expect(s.p).toBe(9);
    expect(s.t).toBe(5);
    const rec = JSON.parse(JSON.stringify(a.toJSON()));
    expect(validRecording(rec)).toBe(true);
    expect(replayAt(rec, 0).text).toBe('');
    expect(replayAt(rec, 1).text).toBe('x = 1\n');
    expect(replayAt(rec, 2).text).toBe('x = 1\nprint(x)\n');
    const end = replayAt(rec, 3);
    expect(end.text).toBe('x = 42\nprint(x)\n');
    expect(end.spans).toEqual([{ len: 4, k: 't' }, { len: 2, k: 'a' }, { len: 1, k: 't' }, { len: 9, k: 'p' }]);
    expect(end.t).toBe(300);
    expect(describeStats(s)).toBe('31% typed · 56% pasted · 13% ai');
  });

  it('starts from a loaded file and handles deletes across kinds', () => {
    const a = new Authorship('abcdef');
    a.record([{ at: 2, del: 2, ins: 'XY' }], 't');
    expect(a.spans).toEqual([{ len: 2, k: 'l' }, { len: 2, k: 't' }, { len: 2, k: 'l' }]);
    a.record([{ at: 1, del: 4, ins: '' }], 't');
    expect(a.spans).toEqual([{ len: 2, k: 'l' }]);
    expect(replayAt(a.toJSON(), 2).text).toBe('af');
  });

  it('rejects malformed recordings from the network', () => {
    expect(validRecording(null)).toBe(false);
    expect(validRecording({ v: 1, base: '', events: [{ at: -1, del: 0, ins: '', k: 't' }] })).toBe(false);
    expect(validRecording({ v: 1, base: '', events: [{ at: 0, del: 0, ins: 'x', k: 'zz' }] })).toBe(false);
  });
});

describe('viva questions from the code', () => {
  it('asks about the most telling ideas, in code order', () => {
    const code = [
      'marks = {"maths": 90, "science": 80}', // 1 dict
      'total = 0',
      'for subject in marks:',                  // 3 for
      '    total += marks[subject]',             // 4 accumulator
      'def fact(n):',                            // 5 recursion
      '    if n <= 1:',
      '        return 1',
      '    return n * fact(n - 1)',
      'age = int(input("Age? "))',               // 9 input-number
    ].join('\n');
    const qs = vivaQuestions(code);
    expect(qs.map((q) => q.kind)).toEqual(['dict', 'accumulator', 'recursion']);
    expect(qs[0].en).toBe('Why did you use a dictionary for marks on line 1? What would be harder with a list?');
    expect(qs[2].line).toBe(5);
    expect(qs[2].hi).toContain('fact()');
    expect(qs[1].lineText).toBe('total += marks[subject]');
  });

  it('can ask for more, and asks something even about simple code', () => {
    const code = 'name = input("Name? ")\nprint("Hello", name)\n';
    const qs = vivaQuestions(code);
    expect(qs).toHaveLength(1);
    expect(qs[0].kind).toBe('explain');
    expect(qs[0].line).toBe(2);
    expect(vivaQuestions('')).toEqual([]);
    expect(vivaQuestions('for i in range(10):\n    print(i)\nwhile x < 3:\n    x += 1\n', { max: 5 }).map((q) => q.kind))
      .toEqual(['for-range', 'while', 'accumulator']);
  });

  it('ignores words inside strings and comments', () => {
    expect(vivaQuestions('print("while x: for y in z: def f(): pass")  # class A').map((q) => q.kind)).toEqual(['explain']);
  });
});

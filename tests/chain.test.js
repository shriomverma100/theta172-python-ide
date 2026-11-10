import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chainSteps, chainAt, expressionOf, statementAt, describeChange } from '../src/learn/chain.js';

const require = createRequire(import.meta.url);
const { Kernel } = require('../electron/kernel.cjs');

describe('Chain Lens: finding the steps', () => {
  it('cuts a pandas chain after each call and attribute', () => {
    expect(chainSteps('df.dropna().groupby("Pclass").mean().round(1)')).toEqual([
      'df', 'df.dropna()', 'df.dropna().groupby("Pclass")', 'df.dropna().groupby("Pclass").mean()', 'df.dropna().groupby("Pclass").mean().round(1)',
    ]);
    expect(chainSteps('df[df.age > 30].sort_values("age").head(3)')).toEqual([
      'df', 'df[df.age > 30]', 'df[df.age > 30].sort_values("age")', 'df[df.age > 30].sort_values("age").head(3)',
    ]);
    expect(chainSteps('arr.reshape(2, 3).T.sum(axis=0)')).toEqual(['arr', 'arr.reshape(2, 3)', 'arr.reshape(2, 3).T', 'arr.reshape(2, 3).T.sum(axis=0)']);
  });

  it('keeps module calls whole and ignores dots in strings', () => {
    expect(chainSteps('pd.read_csv("a.b.csv").dropna()')).toEqual(['pd', 'pd.read_csv("a.b.csv")', 'pd.read_csv("a.b.csv").dropna()']);
  });

  it('is not a chain: one step, or an operator expression', () => {
    expect(chainSteps('df')).toEqual([]);
    expect(chainSteps('a.b() + c.d()')).toEqual([]);
    expect(chainSteps('df.dropna(')).toEqual([]);
  });

  it('takes the value side of assignments, return and print', () => {
    expect(expressionOf('clean = df.dropna().reset_index()')).toBe('df.dropna().reset_index()');
    expect(expressionOf('print(df.head())')).toBe('df.head()');
    expect(expressionOf('return x.mean()')).toBe('x.mean()');
    expect(expressionOf('ok = a == b.c()')).toBe('a == b.c()');
  });

  it('follows a chain written over several lines', () => {
    const code = ['import pandas as pd', 'result = (', '    df.dropna()', '      .groupby("cls")  # by class', '      .mean()', ')', 'print(result)'].join('\n');
    const at = chainAt(code, 4);
    expect(at.from).toBe(2);
    expect(at.to).toBe(6);
    expect(at.steps).toEqual(['df', 'df.dropna()', 'df.dropna().groupby("cls")', 'df.dropna().groupby("cls").mean()']);
    expect(statementAt(code.split('\n'), 7).text).toBe('print(result)');
  });

  it('describes what changed between steps', () => {
    expect(describeChange({ type: 'DataFrame', shape: [891, 12] }, { type: 'DataFrame', shape: [714, 12] })).toBe('−177 rows');
    expect(describeChange({ type: 'DataFrame', shape: [3, 5] }, { type: 'DataFrame', shape: [3, 7] })).toBe('+2 columns');
    expect(describeChange({ type: 'DataFrame', shape: [10, 2] }, { type: 'DataFrameGroupBy', groups: 3 })).toBe('3 groups');
    expect(describeChange({ type: 'list', len: 3 }, { type: 'list', len: 3 })).toBe('same size');
    expect(describeChange(null, { type: 'DataFrame', shape: [1, 1] })).toBe('');
  });
});

// ── The kernel evaluates each step ─────────────────────────────────
const PY = [path.resolve('vendor/win-x64/python/python.exe')].find((p) => fs.existsSync(p));

describe.skipIf(!PY)('Chain Lens in the kernel', () => {
  it('summarises every step without changing variables', async () => {
    const got = [];
    const kernel = new Kernel({ spawn, onMessage: (m) => got.push(m) });
    const wait = (test) => new Promise((resolve) => {
      const t = setInterval(() => { const m = got.find(test); if (m) { clearInterval(t); resolve(m); } }, 20);
    });
    try {
      await kernel.start({ python: PY, cwd: process.cwd(), env: process.env });
      kernel.execute('a', 'nums = [5, 3, 9, 1]');
      await wait((m) => m.type === 'done' && m.id === 'a');
      kernel.lens('L1', ['nums', 'sorted(nums)', 'sorted(nums)[1:]', 'sorted(nums)[1:].count(3)']);
      const res = await wait((m) => m.type === 'lens-result' && m.id === 'L1');
      expect(res.error).toBe(null);
      expect(res.steps.map((s) => [s.type, s.len ?? null, s.preview])).toEqual([
        ['list', 4, '[5, 3, 9, 1]'], ['list', 4, '[1, 3, 5, 9]'], ['list', 3, '[3, 5, 9]'], ['int', null, '1'],
      ]);
      kernel.lens('L2', ['nums', 'nums.missing()']);
      const bad = await wait((m) => m.type === 'lens-result' && m.id === 'L2');
      expect(bad.steps).toHaveLength(1);
      expect(bad.error.ename).toBe('AttributeError');
      kernel.execute('b', 'nums');
      await wait((m) => m.type === 'done' && m.id === 'b');
      expect(got.find((m) => m.id === 'b' && m.type === 'result').data['text/plain']).toBe('[5, 3, 9, 1]');
    } finally {
      kernel.stop();
    }
  }, 30_000);
});

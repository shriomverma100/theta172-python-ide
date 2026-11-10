import { describe, it, expect } from 'vitest';
import {
  createTests, applyEvent, beginCollect, endCollect, beginRun, endRun, tree, summary, failedIds, fileMarks, inRun, groupStatus, isTestFile,
} from '../src/testing/test-model.js';

const F = 'C:\\proj\\tests\\test_calc.py';
const item = (nodeid, line, cls = null) => ({ type: 'item', nodeid, file: F, line, name: nodeid.split('::').pop(), cls });

function collected() {
  const m = createTests();
  beginCollect(m);
  applyEvent(m, item('tests/test_calc.py::test_add', 4));
  applyEvent(m, item('tests/test_calc.py::test_sub', 8));
  applyEvent(m, item('tests/test_calc.py::TestMore::test_zero', 13, 'TestMore'));
  endCollect(m);
  return m;
}

describe('test model', () => {
  it('builds a file → class → test tree', () => {
    const t = tree(collected());
    expect(t).toHaveLength(1);
    expect(t[0].tests.map((x) => x.name)).toEqual(['test_add', 'test_sub']);
    expect(t[0].classes[0]).toMatchObject({ id: 'tests/test_calc.py::TestMore', name: 'TestMore' });
  });

  it('tracks a run: queued, running, results, summary', () => {
    const m = collected();
    beginRun(m, ['tests/test_calc.py::TestMore']);
    expect(m.items.get('tests/test_calc.py::TestMore::test_zero').status).toBe('queued');
    expect(m.items.get('tests/test_calc.py::test_add').status).toBe('unknown');
    applyEvent(m, { type: 'start', nodeid: 'tests/test_calc.py::TestMore::test_zero' });
    expect(groupStatus(tree(m)[0].classes[0].tests)).toBe('running');
    applyEvent(m, { type: 'result', nodeid: 'tests/test_calc.py::TestMore::test_zero', outcome: 'passed', when: 'call', duration: 0.01 });
    endRun(m);
    beginRun(m);
    applyEvent(m, { type: 'result', nodeid: 'tests/test_calc.py::test_add', outcome: 'passed', when: 'call', duration: 0.1 });
    applyEvent(m, { type: 'result', nodeid: 'tests/test_calc.py::test_sub', outcome: 'failed', when: 'call', message: 'assert 1 == 2', line: 9, path: F });
    endRun(m);
    expect(summary(m)).toMatchObject({ total: 3, passed: 1, failed: 1, notRun: 1 });
    expect(failedIds(m)).toEqual(['tests/test_calc.py::test_sub']);
    expect(groupStatus(tree(m)[0].tests)).toBe('failed');
    const marks = fileMarks(m, 'c:/proj/tests/test_calc.py');
    expect(marks.get(8)).toMatchObject({ status: 'failed', message: 'assert 1 == 2' });
    expect(marks.get(4).status).toBe('passed');
  });

  it('a failing fixture is an error, not a failure of the test itself', () => {
    const m = collected();
    applyEvent(m, { type: 'result', nodeid: 'tests/test_calc.py::test_add', outcome: 'failed', when: 'setup', message: 'fixture broke' });
    expect(m.items.get('tests/test_calc.py::test_add').status).toBe('error');
  });

  it('rediscovery drops removed tests but keeps results of the others', () => {
    const m = collected();
    applyEvent(m, { type: 'result', nodeid: 'tests/test_calc.py::test_add', outcome: 'passed', when: 'call' });
    beginCollect(m);
    applyEvent(m, item('tests/test_calc.py::test_add', 4));
    endCollect(m);
    expect([...m.items.keys()]).toEqual(['tests/test_calc.py::test_add']);
    expect(m.items.get('tests/test_calc.py::test_add').status).toBe('passed');
  });

  it('matches files, classes and tests in a run', () => {
    expect(inRun('a.py::T::t', ['a.py'])).toBe(true);
    expect(inRun('a.py::T::t', ['a.py::T'])).toBe(true);
    expect(inRun('ab.py::t', ['a.py'])).toBe(false);
    expect(inRun('x', [])).toBe(true);
    expect(isTestFile('C:\\p\\tests\\test_x.py')).toBe(true);
    expect(isTestFile('/p/x_test.py')).toBe(true);
    expect(isTestFile('/p/main.py')).toBe(false);
  });
});

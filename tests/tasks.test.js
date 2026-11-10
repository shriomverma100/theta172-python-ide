import { describe, it, expect } from 'vitest';
import { parseTasksFile } from '../src/app/tasks-file.js';

describe('project tasks (.theta/tasks.json)', () => {
  it('reads labelled commands', () => {
    const { tasks, error } = parseTasksFile(JSON.stringify({
      tasks: [
        { label: 'Train', command: 'python train.py --epochs 5', detail: 'the big one' },
        { label: '  Lint ', command: ' ruff check . ' },
        { label: 'No command' },
        { command: 'no label' },
      ],
    }));
    expect(error).toBe(null);
    expect(tasks).toEqual([
      { label: 'Train', command: 'python train.py --epochs 5', detail: 'the big one' },
      { label: 'Lint', command: 'ruff check .', detail: '' },
    ]);
  });

  it('explains what is wrong with a broken file', () => {
    expect(parseTasksFile('{ tasks: [').error).toMatch(/not valid JSON/);
    expect(parseTasksFile('{"tasks": [{"name": "x"}]}').error).toMatch(/label/);
    expect(parseTasksFile('{}')).toEqual({ tasks: [], error: null });
  });
});

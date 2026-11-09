import { describe, it, expect } from 'vitest';
import { tidyTraceback, errorLineInUserCode } from '../src/core/traceback.js';

const LOCAL = String.raw`Traceback (most recent call last):
  File "C:\Users\a\AppData\Local\Temp\theta_run_f73648f9-83c6-4a86-865b-810296822d8b.py", line 4, in <module>
    print(ratio(4, 0))
  File "C:\Users\a\AppData\Local\Temp\theta_run_f73648f9-83c6-4a86-865b-810296822d8b.py", line 2, in ratio
    return a / b
ZeroDivisionError: division by zero
`;

describe('tracebacks', () => {
  it('shows the tab name instead of the temp file (and hides the user folder)', () => {
    const out = tidyTraceback(LOCAL, 'main.py');
    expect(out).not.toContain('theta_run_');
    expect(out).not.toContain('AppData');
    expect(out).toContain('File "main.py", line 4, in <module>');
    expect(out).toContain('File "main.py", line 2, in ratio');
  });

  it('keeps $ characters in file names literally', () => {
    expect(tidyTraceback(LOCAL, 'cost$1.py')).toContain('File "cost$1.py", line 4');
  });

  it('highlights the innermost line of the user file', () => {
    expect(errorLineInUserCode(tidyTraceback(LOCAL, 'main.py'), 'main.py')).toBe(2);
  });

  it('skips frames inside libraries', () => {
    const tb = String.raw`  File "main.py", line 3, in <module>
  File "C:\Python\Lib\site-packages\pandas\core\frame.py", line 4102, in __getitem__
KeyError: 'age'`;
    expect(errorLineInUserCode(tb, 'main.py')).toBe(3);
  });

  it('understands Pyodide tracebacks', () => {
    expect(errorLineInUserCode('  File "<exec>", line 7, in <module>\nNameError', 'main.py')).toBe(7);
  });

  it('falls back to a bare line number for syntax errors', () => {
    expect(errorLineInUserCode('SyntaxError: invalid syntax (line 5)', 'main.py')).toBe(5);
  });

  it('does not guess when only library frames are present', () => {
    expect(errorLineInUserCode('  File "/usr/lib/python3/json/decoder.py", line 355, in raw_decode', 'main.py')).toBeNull();
  });
});

describe('tracebacks inside a project', () => {
  it('shows project paths relative to the project folder', () => {
    const tb = String.raw`  File "D:\Projects\Dice Game\main.py", line 2, in <module>
    from src.helpers import add
  File "d:\projects\dice game\src\helpers.py", line 4, in add
ZeroDivisionError: division by zero`;
    const out = tidyTraceback(tb, 'main.py', String.raw`D:\Projects\Dice Game`);
    expect(out).toContain('File "main.py", line 2');
    expect(out).toContain(String.raw`File "src\helpers.py", line 4`); // Windows: case-insensitive
    expect(out).not.toContain('Projects');
  });

  it('highlights the active project file by its relative path', () => {
    const tb = String.raw`  File "main.py", line 2, in <module>
  File "src\helpers.py", line 4, in add`;
    expect(errorLineInUserCode(tb, String.raw`src\helpers.py`)).toBe(4);
    expect(errorLineInUserCode(tb, 'main.py')).toBe(2);
  });
});

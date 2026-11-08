import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { isValidPackageSpec as rendererSpec } from '../src/core/package-spec.js';
import { canApplyPushedCode, validateLiveEdit, MAX_LIVE_INSERT } from '../src/classroom/edit-guard.js';

const require = createRequire(import.meta.url);
const { FileAccess } = require('../electron/file-access.cjs');
const { isValidPackageSpec: mainSpec, sanitizeLabel, sanitizeText } = require('../electron/validate.cjs');
const { ClassroomServer } = require('../electron/classroom-server.cjs');

describe('package spec validation', () => {
  const valid = ['requests', 'requests[socks]', 'numpy==2.1.0', 'pandas>=2', 'torch~=2.5', 'scikit-learn', 'a', 'zope.interface'];
  const invalid = ['', '-r requirements.txt', '--index-url=http://x', 'pkg; rm -rf /', 'pkg && calc', 'a b', '../evil', 'pkg==1.0 --pre', '-e .'];

  it.each(valid)('accepts %s', (s) => {
    expect(mainSpec(s)).toBe(true);
    expect(rendererSpec(s)).toBe(true);
  });

  it.each(invalid)('rejects %s', (s) => {
    expect(mainSpec(s)).toBe(false);
    expect(rendererSpec(s)).toBe(false);
  });
});

describe('FileAccess', () => {
  it('only allows paths chosen in a dialog', () => {
    const fa = new FileAccess('win32');
    expect(fa.isAllowed('C:\\Users\\me\\a.py')).toBe(false);
    fa.allow('C:\\Users\\me\\a.py');
    expect(fa.isAllowed('c:\\users\\ME\\a.py')).toBe(true);           // Windows is case-insensitive
    expect(fa.isAllowed('C:\\Users\\me\\sub\\..\\a.py')).toBe(true);   // normalised
    expect(fa.isAllowed('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe(false);
    expect(fa.isAllowed(undefined)).toBe(false);
  });

  it('is case-sensitive on Linux', () => {
    const fa = new FileAccess('linux');
    fa.allow('/home/me/a.py');
    expect(fa.isAllowed('/home/me/A.py')).toBe(false);
  });
});

describe('network text sanitizing', () => {
  it('strips control and bidi characters and caps length', () => {
    expect(sanitizeLabel('Ali\u202Ece\u0000\n  X', 64)).toBe('Alice X');
    expect(sanitizeLabel('x'.repeat(100), 10)).toHaveLength(10);
    expect(sanitizeLabel(42, 10, 'fallback')).toBe('fallback');
    expect(sanitizeText('line1\nline2\u0007', 100)).toBe('line1\nline2');
  });

  it('classroom server cleans student join data', () => {
    const server = new ClassroomServer();
    const joined = [];
    server.onStudentJoin = (info) => joined.push(info);
    server.students.set('student-1', { ws: {}, name: '', roll: '', code: '', fileName: '', helpRequested: false, editPermission: false });
    server._handleStudentMessage('student-1', { type: 'join', name: '<img src=x onerror=alert(1)>\u202E'.padEnd(200, 'A'), roll: { bad: 1 } });
    expect(joined).toHaveLength(1);
    expect(joined[0].name.length).toBeLessThanOrEqual(64);
    expect(joined[0].name).not.toContain('\u202E');
    expect(joined[0].roll).toBe('');
  });
});

describe('student edit guard', () => {
  it('rejects pushed code without permission', () => {
    expect(canApplyPushedCode(false, { code: 'print(1)' })).toBe(false);
    expect(canApplyPushedCode(true, { code: 'print(1)' })).toBe(true);
    expect(canApplyPushedCode(true, { code: 123 })).toBe(false);
    expect(canApplyPushedCode(true, null)).toBe(false);
  });

  it('validates live edit ranges', () => {
    expect(validateLiveEdit(false, { from: 0, to: 0, insert: 'x' }, 10)).toBeNull();
    expect(validateLiveEdit(true, { from: 2, to: 5, insert: 'x' }, 10)).toEqual({ from: 2, to: 5, insert: 'x' });
    expect(validateLiveEdit(true, { from: 5, to: 2, insert: 'x' }, 10)).toBeNull();
    expect(validateLiveEdit(true, { from: 0, to: 11, insert: 'x' }, 10)).toBeNull();
    expect(validateLiveEdit(true, { from: -1, to: 0, insert: 'x' }, 10)).toBeNull();
    expect(validateLiveEdit(true, { from: 1.5, to: 2, insert: 'x' }, 10)).toBeNull();
    expect(validateLiveEdit(true, { from: 0, to: 0, insert: 'x'.repeat(MAX_LIVE_INSERT + 1) }, 10)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { Text } from '@codemirror/state';
import { lineChanges } from '../src/git-gutter.js';

const require = createRequire(import.meta.url);
const { Git, friendlyGitError } = require('../electron/git.cjs');

const T = (s) => Text.of(s.split('\n'));

describe('Change markers in the gutter', () => {
  it('marks added, changed and deleted lines', () => {
    const base = T('a\nb\nc\nd\n');
    expect(lineChanges(base, T('a\nb\nNEW\nc\nd\n'))).toEqual([{ line: 3, kind: 'added' }]);
    expect(lineChanges(base, T('a\nB!\nc\nd\n'))).toEqual([{ line: 2, kind: 'modified' }]);
    expect(lineChanges(base, T('a\nc\nd\n'))).toEqual([{ line: 2, kind: 'deleted' }]);
    expect(lineChanges(base, base)).toEqual([]);
  });

  it('handles changes at the very end and an empty base (new file)', () => {
    // With a final newline only the new line is "added"
    expect(lineChanges(T('a\nb\n'), T('a\nb\nc\n'))).toEqual([{ line: 3, kind: 'added' }]);
    // Without one, the old last line also changed (it gained a line break)
    expect(lineChanges(T('a\nb'), T('a\nb\nc'))).toEqual([{ line: 2, kind: 'modified' }, { line: 3, kind: 'modified' }]);
    const fresh = lineChanges(T(''), T('x\ny'));
    expect(fresh.every((c) => c.kind === 'added' || c.kind === 'modified')).toBe(true);
    expect(fresh.map((c) => c.line)).toEqual([1, 2]);
  });
});

describe('Git status parsing (porcelain v2)', () => {
  it('splits staged and unstaged changes, renames, untracked and conflicts', () => {
    const out = [
      '# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 h1 h2 main.py',
      '1 M. N... 100644 100644 100644 h1 h2 src/app.py',
      '2 R. N... 100644 100644 100644 h1 h2 R100 sub dir/new name.py', 'sub dir/old name.py',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 clash.py',
      '? notes/todo.txt', '',
    ].join('\0');
    const s = Git.parseStatus(out);
    expect(s).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(s.files).toEqual([
      { path: 'main.py', staged: null, unstaged: 'M', kind: 'tracked' },
      { path: 'src/app.py', staged: 'M', unstaged: null, kind: 'tracked' },
      { path: 'sub dir/new name.py', orig: 'sub dir/old name.py', staged: 'R', unstaged: null, kind: 'tracked' },
      { path: 'clash.py', staged: null, unstaged: 'U', kind: 'conflict' },
      { path: 'notes/todo.txt', staged: null, unstaged: 'A', kind: 'untracked' },
    ]);
  });

  it('reads a new repository and a detached HEAD', () => {
    expect(Git.parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ branch: 'main', oid: null, ahead: 0 });
    expect(Git.parseStatus('# branch.oid abc\0# branch.head (detached)\0').branch).toBeNull();
  });

  it('reads branches and history', () => {
    const refs = Git.parseRefs('refs/heads/main\x1f*\x1forigin/main\nrefs/heads/dev\x1f \x1f\nrefs/remotes/origin/HEAD\x1f \x1f\nrefs/remotes/origin/main\x1f \x1f\n');
    expect(refs).toEqual({ current: 'main', local: [{ name: 'main', upstream: 'origin/main' }, { name: 'dev', upstream: null }], remote: [{ name: 'origin/main' }] });
    const log = Git.parseLog('h1\x1fa1\x1fAda\x1f2 hours ago\x1fFix loop\x1e\nh2\x1fa2\x1fAda\x1f3 days ago\x1fFirst\x1e');
    expect(log.map((c) => c.subject)).toEqual(['Fix loop', 'First']);
  });

  it('turns git errors into plain sentences', () => {
    expect(friendlyGitError('*** Please tell me who you are.\n\nRun\n  git config --global user.email')).toBe('IDENTITY');
    expect(friendlyGitError('fatal: could not read Username for https://github.com: terminal prompts disabled')).toMatch(/sign in/);
    expect(friendlyGitError('hint: something\nerror: failed to push some refs\n ! [rejected] main -> main (non-fast-forward)')).toMatch(/Pull first/);
  });
});

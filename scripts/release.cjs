/**
 * Publish a new version to every installed copy.
 *
 *   npm run release -- patch            1.1.0 → 1.1.1  (fixes)
 *   npm run release -- minor            1.1.0 → 1.2.0  (new features)
 *   npm run release -- major            1.1.0 → 2.0.0
 *   npm run release -- 1.4.0            an exact version
 *   add --critical                      no "Later" button for this update
 *   add --dry                           show what would happen, change nothing
 *
 * Before running: write what changed in RELEASE_NOTES.md (one line per
 * change, "- " at the start). The script checks you are on main with
 * nothing uncommitted, runs lint and the tests, sets the version, copies the
 * notes to release-notes/vX.Y.Z.md, commits, tags vX.Y.Z and pushes. GitHub
 * Actions then builds the installer and publishes the release; installed
 * apps find it within a few hours (or at once with Help → Check for updates).
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const critical = args.includes('--critical');
const bump = args.find((a) => !a.startsWith('--')) || '';

const sh = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', stdio: opts.show ? 'inherit' : 'pipe', shell: process.platform === 'win32' && cmd === 'npm' });
const git = (...a) => sh('git', ['-c', 'safe.directory=*', ...a]).trim();
const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

function nextVersion(current, how) {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [ma, mi, pa] = current.split('.').map(Number);
  if (how === 'major') return `${ma + 1}.0.0`;
  if (how === 'minor') return `${ma}.${mi + 1}.0`;
  if (how === 'patch') return `${ma}.${mi}.${pa + 1}`;
  return null;
}
const newer = (a, b) => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const version = nextVersion(pkg.version, bump);
if (!version) fail('Say how to change the version: patch, minor, major or an exact one like 1.4.0.');
if (!newer(version, pkg.version)) fail(`${version} is not newer than ${pkg.version}.`);
const tag = `v${version}`;

// Notes
const notesFile = path.join(root, 'RELEASE_NOTES.md');
const notesRaw = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : '';
const lines = notesRaw.split(/\r?\n/).filter((l) => /^\s*[-*]\s+\S/.test(l));
if (!lines.length) fail('Write what changed in RELEASE_NOTES.md first (lines starting with "- ").');
const notes = `${lines.join('\n')}\n${critical ? '\n[critical]\n' : ''}`;

// Where we are
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`Releases come from main (you are on ${branch}). Merge your work into main first.`);
const dirty = git('status', '--porcelain').split('\n').filter((l) => l && !/RELEASE_NOTES\.md$/.test(l));
if (dirty.length) fail(`Commit or stash these first:\n${dirty.join('\n')}`);
if (git('tag', '--list', tag)) fail(`The tag ${tag} already exists.`);

console.log(`\nRelease ${pkg.version} → ${version}${critical ? ' (critical)' : ''}\n\n${notes}`);
if (dry) { console.log('Dry run: nothing changed.'); process.exit(0); }

console.log('Checking: lint and tests…');
try { sh('npm', ['run', 'lint'], { show: true }); sh('npm', ['test'], { show: true }); } catch (_) { fail('Lint or tests failed. Fix them, then release again.'); }

pkg.version = version;
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
const lockFile = path.join(root, 'package-lock.json');
if (fs.existsSync(lockFile)) {
  const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
}
fs.mkdirSync(path.join(root, 'release-notes'), { recursive: true });
fs.writeFileSync(path.join(root, 'release-notes', `${tag}.md`), notes);
fs.writeFileSync(notesFile, '# Release notes for the next version\n\nOne line per change, starting with "- ". `npm run release` publishes them.\n\n');

git('add', 'package.json', 'package-lock.json', 'release-notes', 'RELEASE_NOTES.md');
git('commit', '-m', `Release ${tag}`);
git('tag', '-a', tag, '-m', `Python by THETA172 ${version}`);
console.log('Pushing…');
git('push', 'origin', 'main');
git('push', 'origin', tag);
console.log(`\n✓ ${tag} pushed. GitHub Actions now builds and publishes it (about 15 minutes):\n  https://github.com/${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}/actions\n`);

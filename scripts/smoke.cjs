/**
 * Smoke test: launch the built app in Electron and fail on renderer errors.
 * Usage: npm run test:smoke   (runs `vite build` first)
 */
const { spawn } = require('child_process');
const path = require('path');

const electron = require('electron'); // resolves to the electron binary path
const root = path.join(__dirname, '..');

// A tiny two-file project: main.py imports a module from src/
const fs = require('fs');
const os = require('os');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-smoke-project-'));
fs.mkdirSync(path.join(project, 'src'));
fs.writeFileSync(path.join(project, 'src', '__init__.py'), '');
fs.writeFileSync(path.join(project, 'src', 'helpers.py'), 'def add(a, b):\n    return a + b\n');
fs.writeFileSync(path.join(project, 'main.py'), 'from src.helpers import add\nprint("IMPORT_OK", add(40, 2))\n');

// Tools like VS Code set ELECTRON_RUN_AS_NODE, which would start plain Node.
// Git settings the test may write (name and email) go to a throwaway file,
// never to the developer's own ~/.gitconfig
const gitConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theta-smoke-git-')), 'gitconfig');
fs.writeFileSync(gitConfig, '');
const env = {
  ...process.env, NODE_ENV: 'production', THETA_SMOKE: '1', THETA_SMOKE_WORKSPACE: project,
  GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1',
};
// Names from the developer's environment would skip the "who are you?" step under test
for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[k];
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let result = null;
child.stdout.on('data', (buf) => {
  for (const line of buf.toString().split(/\r?\n/)) {
    if (line.startsWith('THETA_SMOKE_RESULT ')) result = JSON.parse(line.slice(19));
    else if (line.startsWith('STEP ')) process.stderr.write(`  ${line}
`); // progress, to see where a slow run spends its time
  }
});

const timeout = setTimeout(() => {
  console.error('Smoke test timed out');
  child.kill();
  process.exit(1);
}, 150_000); // the probe now covers nine phases

child.on('exit', (code) => {
  clearTimeout(timeout);
  if (!result) {
    console.error(`Smoke test produced no result (exit ${code})`);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
});

/**
 * Design review screenshots: npm run shots [-- 1 1.25 1.5]
 * Run `vite build` first (npm run shots does). Saves to tmp/shots/.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, 'tmp', 'shots');
const scales = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '1.25', '1.5'];

// A small sample project so the explorer has something to show
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'theta-shots-project-'));
for (const d of ['src', 'data', 'notebooks']) fs.mkdirSync(path.join(project, d));
const files = {
  'main.py': 'from src.helpers import add\n\nprint("total", add(40, 2))\n',
  'src/helpers.py': 'def add(a, b):\n    return a + b\n',
  'src/__init__.py': '',
  'data/scores.csv': 'name,score\naarav,91\n',
  'notebooks/explore.ipynb': '{}',
  'README.md': '# Dice game\n',
};
for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(project, f), c);

for (const scale of scales) {
  const env = { ...process.env, NODE_ENV: 'production', THETA_SMOKE: '1', THETA_SHOTS: out, THETA_SCALE: scale, THETA_SMOKE_WORKSPACE: project };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, ['.'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  const lines = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('THETA_'));
  console.log(`scale ${scale}: exit ${r.status}`);
  lines.forEach((l) => console.log('  ' + l));
  const errs = (r.stderr || '').split(/\r?\n/).filter((l) => /shots failed|Error/.test(l));
  errs.slice(0, 8).forEach((l) => console.log('  ! ' + l));
}

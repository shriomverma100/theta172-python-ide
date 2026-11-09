/**
 * Design review screenshots: npm run shots [-- 1 1.25 1.5]
 * Run `vite build` first (npm run shots does). Saves to tmp/shots/.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const electron = require('electron');

const root = path.join(__dirname, '..');
const out = path.join(root, 'tmp', 'shots');
const scales = process.argv.slice(2).length ? process.argv.slice(2) : ['1', '1.25', '1.5'];

for (const scale of scales) {
  const env = { ...process.env, NODE_ENV: 'production', THETA_SMOKE: '1', THETA_SHOTS: out, THETA_SCALE: scale };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, ['.'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  const lines = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('THETA_'));
  console.log(`scale ${scale}: exit ${r.status}`);
  lines.forEach((l) => console.log('  ' + l));
  const errs = (r.stderr || '').split(/\r?\n/).filter((l) => /shots failed|Error/.test(l));
  errs.slice(0, 8).forEach((l) => console.log('  ! ' + l));
}

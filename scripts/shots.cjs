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
  'notebooks/explore.ipynb': JSON.stringify({
    cells: [
      { cell_type: 'markdown', id: 'intro', metadata: {}, source: '# Exam scores\nA quick look at the class results: the **average**, the spread, and who needs help.\n\n- load the scores with `pandas`\n- plot them with `matplotlib`' },
      { cell_type: 'code', id: 'load', metadata: {}, execution_count: null, outputs: [], source: "import pandas as pd\n\nscores = pd.DataFrame({\n    'name': ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan'],\n    'score': [91, 78, 64, 88, 52],\n})\nscores" },
      { cell_type: 'code', id: 'avg', metadata: {}, execution_count: null, outputs: [], source: "avg = scores.score.mean()\nprint(f'average {avg:.1f}')\nscores[scores.score < avg]" },
      { cell_type: 'code', id: 'plot', metadata: {}, execution_count: null, outputs: [], source: "import matplotlib.pyplot as plt\n\nfig, ax = plt.subplots(figsize=(6, 2.6))\nax.bar(scores.name, scores.score, color='#FF4A36')\nax.axhline(avg, color='#17142E', linestyle='--', label='average')\nax.set_title('Scores')\nax.legend()\nplt.show()" },
      { cell_type: 'markdown', id: 'ask', metadata: {}, source: '## Check one student' },
      { cell_type: 'code', id: 'input', metadata: {}, execution_count: null, outputs: [], source: "name = input('Who should we check? ')\nscores[scores.name == name]" },
      { cell_type: 'code', id: 'oops', metadata: {}, execution_count: null, outputs: [], source: "scores['grade']" },
    ],
    metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' } },
    nbformat: 4,
    nbformat_minor: 5,
  }, null, 1),
  'README.md': '# Dice game\n',
};
for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(project, f), c);
// The notebook tour needs pandas and matplotlib: use the local test environment as the project's .venv
const nbenv = path.join(root, 'tmp', 'nbenv');
if (['notebook', 'p10'].includes(process.env.THETA_SHOTS_SET) && fs.existsSync(nbenv)) {
  try { fs.symlinkSync(nbenv, path.join(project, '.venv'), 'junction'); } catch (err) { console.log('no .venv link:', err.message); }
}

for (const scale of scales) {
  // Git settings written by the tour (name, email) go to a throwaway file, never ~/.gitconfig
  const gitConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'theta-shots-git-')), 'gitconfig');
  fs.writeFileSync(gitConfig, '');
  const env = {
    ...process.env, NODE_ENV: 'production', THETA_SMOKE: '1', THETA_SHOTS: out, THETA_SCALE: scale, THETA_SMOKE_WORKSPACE: project,
    GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1',
  };
  for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[k];
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, ['.'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  const lines = (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('THETA_'));
  console.log(`scale ${scale}: exit ${r.status}`);
  lines.forEach((l) => console.log('  ' + l));
  const errs = (r.stderr || '').split(/\r?\n/).filter((l) => /shots failed|Error/.test(l));
  errs.slice(0, 8).forEach((l) => console.log('  ! ' + l));
}

// Run Coach — a THETA172 plugin that listens to runs.
// Keeps today's numbers in the plugin's own storage.

const today = new Date().toISOString().slice(0, 10);
let stats = (await theta.storage.get('stats')) || {};
if (stats.day !== today) stats = { day: today, runs: 0, errors: 0, fixed: 0 };
let failing = false;

const show = () => theta.statusBar.set('coach', `${stats.runs} runs · ${stats.fixed} fixed`, `Today: ${stats.runs} runs, ${stats.errors} errors, ${stats.fixed} fixed`);
show();

theta.runs.onFinish(async (run) => {
  stats.runs++;
  if (!run.ok) {
    stats.errors++;
    failing = true;
  } else if (failing) {
    failing = false;
    stats.fixed++;
    await theta.window.showMessage(`Fixed it! That is ${stats.fixed} today.`, 'success');
  }
  await theta.storage.set('stats', stats);
  show();
});

theta.commands.register('today', 'Show today\'s runs', () =>
  theta.window.showMessage(`${stats.runs} runs, ${stats.errors} errors, ${stats.fixed} fixed today`));

// TODO Finder — a THETA172 plugin.
// Reads the project's .py files, finds TODO / FIXME comments and shows them
// in a panel. Panel HTML is cleaned by the app; buttons with data-action
// send their action back here.

let found = [];

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function pythonFiles(dir = '', depth = 0) {
  if (depth > 4) return [];
  const out = [];
  for (const entry of await theta.workspace.listFiles(dir)) {
    if (entry.type === 'dir' && !entry.name.startsWith('.') && !['venv', '__pycache__', 'node_modules'].includes(entry.name)) {
      out.push(...(await pythonFiles(entry.path, depth + 1)));
    } else if (entry.type === 'file' && entry.name.endsWith('.py')) out.push(entry.path);
  }
  return out;
}

async function scan() {
  found = [];
  for (const file of (await pythonFiles()).slice(0, 300)) {
    const lines = (await theta.workspace.readFile(file)).split('\n');
    lines.forEach((line, i) => {
      const m = /#\s*(TODO|FIXME)\b[:\s]*(.*)$/i.exec(line);
      if (m) found.push({ file, line: i + 1, kind: m[1].toUpperCase(), text: m[2].trim() || '(no text)' });
    });
  }
  const rows = found.map((t, i) => `<li><button data-action="open-${i}">${escape(t.file)}:${t.line}</button> <b>${t.kind}</b> ${escape(t.text)}</li>`).join('');
  await theta.ui.showPanel({
    title: `${found.length} to do`,
    html: found.length ? `<ul>${rows}</ul><p><button data-action="rescan">Look again</button></p>` : '<p>No TODO or FIXME comments. Nice.</p><p><button data-action="rescan">Look again</button></p>',
  });
}

theta.ui.onAction(async ({ action }) => {
  if (action === 'rescan') return scan();
  const t = found[Number(action.replace('open-', ''))];
  if (t) await theta.workspace.openFile(t.file, t.line);
});

theta.commands.register('find', 'Find TODO comments in the project', scan);

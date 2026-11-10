/** Reading .theta/tasks.json (pure, no app imports). */

export const MAX_TASKS = 50;

/** Tasks from .theta/tasks.json: { tasks: [{ label, command, detail }], error } */
export function parseTasksFile(text) {
  let data;
  try { data = JSON.parse(text); } catch (err) { return { tasks: [], error: `tasks.json is not valid JSON: ${err.message}` }; }
  const list = Array.isArray(data?.tasks) ? data.tasks : [];
  const tasks = list.slice(0, MAX_TASKS)
    .filter((t) => t && typeof t.label === 'string' && typeof t.command === 'string' && t.label.trim() && t.command.trim())
    .map((t) => ({ label: t.label.trim().slice(0, 80), command: t.command.trim().slice(0, 2000), detail: typeof t.detail === 'string' ? t.detail.slice(0, 200) : '' }));
  return { tasks, error: list.length && !tasks.length ? 'Each task needs a "label" and a "command".' : null };
}

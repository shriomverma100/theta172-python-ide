/**
 * Quick pick: a searchable list in the command palette's style, used for
 * choices like "Select Python interpreter".
 *
 * openQuickPick({ title, items }) where each item is
 *   { label, description?, detail?, checked?, run() }  or  { separator: 'Title' }
 * With `load(query)` the items come from a (debounced, async) search instead.
 * openInputBox({ title, value }) asks for one line of text.
 */
import { focusEditor } from '../editor.js';

let open = null; // the current pick's close()

export function isQuickPickOpen() { return !!open; }

export function closeQuickPick() { open?.(); }

export function openQuickPick({ title = 'Select', items = [], load = null, value = '', emptyText = 'Nothing matches', onCancel = null }) {
  closeQuickPick();

  const root = document.createElement('div');
  root.className = 'cmd-palette quick-pick';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title);
  root.innerHTML = `
    <div class="cmd-palette-backdrop"></div>
    <div class="cmd-palette-box">
      <div class="cmd-input-wrap">
        <svg class="cmd-input-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="m9.5 9.5 3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <input class="cmd-input" autocomplete="off" spellcheck="false" />
      </div>
      <div class="cmd-results" role="listbox"></div>
    </div>`;
  const $input = root.querySelector('.cmd-input');
  const $results = root.querySelector('.cmd-results');
  $input.placeholder = title;
  $input.setAttribute('aria-label', title);

  let shown = [];
  let selected = 0;

  const close = (chosen = false) => {
    if (open !== close) return;
    open = null;
    root.remove();
    focusEditor();
    if (!chosen) onCancel?.();
  };

  const choose = (item) => {
    close(true);
    item.run?.();
  };

  let loadSeq = 0;
  let loadTimer = null;
  const runLoad = () => {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(async () => {
      const seq = ++loadSeq;
      let found = [];
      try { found = await load($input.value.trim()); } catch (_) { found = []; }
      if (seq !== loadSeq || open !== close) return; // a newer search or closed
      items = found;
      shown = items;
      selected = 0;
      render();
    }, 120);
  };

  const filter = () => {
    if (load) { shown = items; return; }
    const q = $input.value.trim().toLowerCase();
    shown = items.filter((it) => it.separator
      ? !q
      : !q || [it.label, it.description, it.detail].some((s) => s && s.toLowerCase().includes(q)));
    const pickable = shown.filter((it) => !it.separator);
    const checked = pickable.findIndex((it) => it.checked);
    selected = q ? 0 : Math.max(0, checked);
  };

  const render = () => {
    $results.textContent = '';
    const pickable = shown.filter((it) => !it.separator);
    if (!pickable.length) {
      const empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = emptyText;
      $results.appendChild(empty);
      return;
    }
    let i = -1;
    for (const it of shown) {
      if (it.separator) {
        const sep = document.createElement('div');
        sep.className = 'qp-separator';
        sep.textContent = it.separator;
        $results.appendChild(sep);
        continue;
      }
      i += 1;
      const idx = i;
      const el = document.createElement('div');
      el.className = `cmd-result-item qp-item${idx === selected ? ' active' : ''}${it.detail ? ' qp-item--detail' : ''}`;
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(idx === selected));

      const check = document.createElement('span');
      check.className = 'qp-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = it.checked ? '✓' : '';

      const text = document.createElement('span');
      text.className = 'qp-text';
      const line = document.createElement('span');
      line.className = 'qp-line';
      const name = document.createElement('span');
      name.className = 'cmd-result-name';
      name.textContent = it.label;
      line.appendChild(name);
      if (it.description) {
        const d = document.createElement('span');
        d.className = 'qp-desc';
        d.textContent = it.description;
        line.appendChild(d);
      }
      text.appendChild(line);
      if (it.detail) {
        const d = document.createElement('span');
        d.className = 'qp-detail';
        d.textContent = it.detail;
        d.title = it.detail;
        text.appendChild(d);
      }
      el.append(check, text);
      el.addEventListener('click', () => choose(it));
      el.addEventListener('mousemove', () => {
        if (selected === idx) return;
        selected = idx;
        render();
      });
      $results.appendChild(el);
    }
    $results.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  $input.addEventListener('input', () => {
    if (load) runLoad();
    else { filter(); render(); }
  });
  $input.addEventListener('keydown', (e) => {
    const pickable = shown.filter((it) => !it.separator);
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(0, Math.min(pickable.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
      render();
      return;
    }
    if (e.key === 'Enter' && pickable[selected]) { e.preventDefault(); choose(pickable[selected]); }
  });
  root.querySelector('.cmd-palette-backdrop').addEventListener('click', () => close());

  document.body.appendChild(root);
  open = close;
  $input.value = value;
  filter();
  render();
  if (load) runLoad();
  setTimeout(() => $input.focus(), 30);
  return close;
}


/**
 * Ask for one line of text in the palette's style.
 * Resolves with the text, or null when cancelled.
 * `validate(text)` returns an error message, or null when the text is fine.
 */
export function openInputBox({ title, value = '', validate = () => null }) {
  closeQuickPick();
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'cmd-palette quick-pick';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', title);
    root.innerHTML = `
      <div class="cmd-palette-backdrop"></div>
      <div class="cmd-palette-box">
        <div class="cmd-input-wrap"><input class="cmd-input" autocomplete="off" spellcheck="false" /></div>
        <div class="cmd-results"><div class="cmd-empty"></div></div>
      </div>`;
    const $input = root.querySelector('.cmd-input');
    const $note = root.querySelector('.cmd-empty');
    $input.value = value;
    $input.setAttribute('aria-label', title);

    const check = () => {
      const err = validate($input.value);
      $note.textContent = err || `${title}. Enter to confirm, Esc to cancel.`;
      $note.classList.toggle('qp-error', !!err);
      return err;
    };
    let closed = false;
    const cancel = () => close(null);
    const close = (result) => {
      if (closed) return;
      closed = true;
      if (open === cancel) open = null;
      root.remove();
      focusEditor();
      resolve(result);
    };

    $input.addEventListener('input', check);
    $input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (!check()) close($input.value);
      }
    });
    root.querySelector('.cmd-palette-backdrop').addEventListener('click', () => close(null));

    document.body.appendChild(root);
    open = cancel; // closeQuickPick() cancels this box too
    check();
    setTimeout(() => { $input.focus(); $input.select(); }, 30);
  });
}

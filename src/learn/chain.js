/**
 * Chain Lens, the parsing part: find the method chain under the cursor
 * (pandas / NumPy / PyTorch style, e.g. df.dropna().groupby("cls").mean())
 * and cut it into its steps:
 *   df · df.dropna() · df.dropna().groupby("cls") · df.dropna().groupby("cls").mean()
 * Each step is a complete expression the kernel can evaluate. Pure functions.
 */

/** Line ranges of the statement containing line `n` (1-based): brackets that span lines are followed. */
export function statementAt(lines, n) {
  const depthOf = (text) => {
    let d = 0;
    let q = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '\\') i++;
        else if (ch === q) q = null;
        continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") q = ch;
      else if ('([{'.includes(ch)) d++;
      else if (')]}'.includes(ch)) d--;
    }
    return d;
  };
  // Walk from the top: a statement starts on a line where no bracket is open
  // and the line before did not end with a backslash
  let a = 0;
  let depth = 0;
  let cont = false;
  for (let i = 0; i < n - 1; i++) {
    if (depth <= 0 && !cont) a = i;
    depth = Math.max(0, depth + depthOf(lines[i]));
    cont = /\\\s*$/.test(lines[i]);
  }
  if (depth <= 0 && !cont) a = n - 1;
  // Downwards until its brackets close
  let b = n - 1;
  depth = 0;
  for (let i = a; i <= b; i++) depth += depthOf(lines[i]);
  while ((depth > 0 || /\\\s*$/.test(lines[b])) && b < lines.length - 1 && b - n < 40) depth += depthOf(lines[++b]);
  const text = lines.slice(a, b + 1).map((l) => l.replace(/\s*#.*$/, '').replace(/\\\s*$/, '')).join(' ').trim();
  return { from: a + 1, to: b + 1, text, indent: (lines[a].match(/^\s*/) || [''])[0].length };
}

/** The value side of a statement: `x = <expr>`, `return <expr>`, `print(<expr>)` or the bare expression. */
export function expressionOf(statement) {
  let s = statement.trim().replace(/;\s*$/, '');
  const assign = topLevelAssign(s);
  if (assign >= 0) s = s.slice(assign + 1).trim();
  s = s.replace(/^(return|yield)\s+/, '');
  const call = /^(print|display|len|list|type)\((.*)\)$/s.exec(s);
  if (call && balanced(call[2])) s = call[2].trim();
  // A chain wrapped in brackets to span lines: ( df.a() .b() )
  while (s.startsWith('(') && s.endsWith(')') && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
  return tidy(s);
}

/** Spaces before a dot outside strings (from line breaks in a chain) go: "a() .b()" → "a().b()". */
function tidy(s) {
  let out = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      out += ch;
      if (ch === '\\') { out += s[++i] ?? ''; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    if (/\s/.test(ch)) {
      const next = s.slice(i).trimStart()[0];
      if (next === '.' || next === ')' || next === ']') continue;
      if (/[([.]$/.test(out)) continue;
    }
    out += ch;
  }
  return out;
}

function balanced(s) {
  let d = 0;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { d--; if (d < 0) return false; }
  }
  return d === 0 && !q;
}

/** Position of a top-level single "=" (an assignment), or -1. */
function topLevelAssign(s) {
  let d = 0;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
    else if (ch === '=' && d === 0 && !'=!<>+-*/%&|^:'.includes(s[i - 1] || '') && s[i + 1] !== '=') return i;
  }
  return -1;
}

/**
 * Cut an expression into the prefixes that end after each step.
 * @returns {string[]} [] when it is not a chain (one step only)
 */
export function chainSteps(expr) {
  const s = String(expr || '').trim();
  if (!s || !balanced(s)) return [];
  const cuts = [];
  let d = 0;
  let q = null;
  let i = 0;
  // The first step: a name (with dots for modules: pd.read_csv), then its call/index if any
  const head = /^[A-Za-z_]\w*/.exec(s);
  if (!head) return [];
  for (i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    // Indexing at the top level (df[...]): what came before is a step of its own
    if (ch === '[' && d === 0 && i > 0) cuts.push(i);
    if ('([{'.includes(ch)) { d++; continue; }
    if (')]}'.includes(ch)) {
      d--;
      // A call or index just closed at the top level: the end of a step (if a dot or [ follows, or at the end)
      if (d === 0) cuts.push(i + 1);
      continue;
    }
    if (d === 0 && ch === '.' && i > 0) {
      // "obj.attr" without a call: the attribute is its own step (df.T, df.columns) when what came before was complete
      cuts.push(i);
    }
    if (d === 0 && /\s/.test(ch)) {
      // Operators at the top level (a + b): not a simple chain
      const rest = s.slice(i).trim();
      if (rest && !/^[.([]/.test(rest)) return [];
    }
  }
  cuts.push(s.length);
  const prefixes = [...new Set(cuts)]
    .filter((c) => c > 0)
    .map((c) => s.slice(0, c).trim())
    // a prefix ending in a bare method name (df.groupby before its call) is not a value worth showing
    .filter((p, idx, all) => !(idx < all.length - 1 && all[idx + 1].startsWith(`${p}(`)));
  const unique = [...new Set(prefixes)];
  return unique.length >= 2 ? unique : [];
}

/** Everything Chain Lens needs from a file and a cursor line: { from, to, indent, expr, steps } or null. */
export function chainAt(code, line) {
  const lines = String(code || '').split('\n');
  if (line < 1 || line > lines.length) return null;
  const st = statementAt(lines, line);
  const expr = expressionOf(st.text);
  const steps = chainSteps(expr);
  if (!steps.length) return null;
  return { from: st.from, to: st.to, indent: st.indent, expr, steps };
}

/** "−177 rows", "+2 columns", "3 groups"… comparing a step with the one before it. */
export function describeChange(prev, cur) {
  if (!cur) return '';
  if (cur.groups != null) return `${cur.groups} group${cur.groups === 1 ? '' : 's'}`;
  if (!prev) return '';
  const p = prev.shape || (prev.len != null ? [prev.len] : null);
  const c = cur.shape || (cur.len != null ? [cur.len] : null);
  if (!p || !c) return prev.type !== cur.type ? `now a ${cur.type}` : '';
  const out = [];
  const diff = (a, b, word) => {
    if (a === undefined || b === undefined || a === b) return;
    const n = b - a;
    out.push(`${n > 0 ? '+' : '−'}${Math.abs(n)} ${word}${Math.abs(n) === 1 ? '' : 's'}`);
  };
  diff(p[0], c[0], 'row');
  if (p.length > 1 || c.length > 1) diff(p[1], c[1], 'column');
  if (!out.length && prev.type !== cur.type) out.push(`now a ${cur.type}`);
  if (!out.length) out.push('same size');
  return out.join(', ');
}

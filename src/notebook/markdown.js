/**
 * A small Markdown renderer for notebook text cells: headings, paragraphs,
 * emphasis, inline code, code blocks, lists (nested by indent), quotes,
 * rules, links, tables and images that come with the notebook. Everything
 * is escaped first, so the only HTML in the result is what this file makes;
 * the result still goes through the sanitizer before it is shown.
 */

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SAFE_LINK = /^(https?:|mailto:|#)/i;
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * Inline formatting on already-escaped text.
 * @param {string} text  escaped text
 * @param {(name: string) => string|null} image  turns an image target into a data: URL (attachments)
 */
function inline(text, image) {
  const codes = [];
  // Code spans first: nothing inside them is formatted
  let s = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => {
    codes.push(`<code>${code.trim()}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // Images: only pictures stored in the notebook (attachment: or data:) are shown
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => {
    const url = image(src.replace(/&amp;/g, '&'));
    return url ? `<img alt="${alt}" src="${url}">` : `<span class="nb-md-missing" title="${src}">[image: ${alt || src}]</span>`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, label, href) => {
    const raw = href.replace(/&amp;/g, '&');
    return SAFE_LINK.test(raw) ? `<a href="${href}">${label}</a>` : label;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => `${pre}<a href="${url}">${url}</a>`);
  s = s.replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)|(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, (m, p1, a, p2, b) => `${p1 ?? p2}<em>${a ?? b}</em>`);
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n|\\\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const isRule = (l) => /^ {0,3}([-*_])( *\1){2,} *$/.test(l);
const isFence = (l) => /^ {0,3}(```|~~~)/.test(l);
const listItem = (l) => /^( *)([-*+]|\d{1,9}[.)]) +(.*)$/.exec(l);
const isTableSep = (l) => /^ *\|? *:?-{2,}:? *(\| *:?-{2,}:? *)*\|? *$/.test(l);
const cellsOf = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());

/**
 * @param {string} source  the cell's Markdown
 * @param {object} [opts]
 * @param {Record<string, Record<string, string>>} [opts.attachments]  the cell's attachments
 * @returns {string} HTML
 */
export function renderMarkdown(source, { attachments } = {}) {
  const image = (src) => {
    if (src.startsWith('attachment:')) {
      const att = attachments?.[decodeURIComponent(src.slice(11))];
      const mime = att && Object.keys(att).find((m) => /^image\/(png|jpeg|gif|webp)$/.test(m));
      return mime ? `data:${mime};base64,${String(Array.isArray(att[mime]) ? att[mime].join('') : att[mime]).replace(/\s/g, '')}` : null;
    }
    return SAFE_IMAGE.test(src) ? src : null;
  };
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(escapeHtml(para.join('\n')), image)}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flush(); i++; continue; }

    if (isFence(line)) {
      flush();
      const fence = line.trim().slice(0, 3);
      const lang = line.trim().slice(3).trim().split(/\s/)[0];
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^ {0,3}(#{1,6}) +(.*?)(?: +#+)? *$/.exec(line);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(escapeHtml(h[2]), image)}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (isRule(line)) { flush(); out.push('<hr>'); i++; continue; }
    // Math blocks are shown as written
    if (/^ *\$\$/.test(line)) {
      flush();
      const body = [line];
      i++;
      if (!/\$\$.*\$\$/.test(line)) {
        while (i < lines.length && !lines[i].includes('$$')) body.push(lines[i++]);
        if (i < lines.length) body.push(lines[i++]);
      }
      out.push(`<pre class="nb-md-math">${escapeHtml(body.join('\n'))}</pre>`);
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), { attachments })}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const head = cellsOf(line);
      const aligns = cellsOf(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cellsOf(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` class="nb-md-${aligns[k]}"` : ''}>${inline(escapeHtml(c), image)}</${tag}>`;
      out.push(`<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, k) => cell('td', c, k)).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = listItem(line);
    if (li) {
      flush();
      const [html, next] = renderList(lines, i, image, attachments);
      out.push(html);
      i = next;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('\n');
}

/** A list starting at lines[start]; nested lists are the more-indented items. */
function renderList(lines, start, image, attachments) {
  const first = listItem(lines[start]);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = listItem(lines[i]);
    if (!m || m[1].length < indent || (m[1].length === indent && /\d/.test(m[2]) !== ordered)) {
      if (m || !lines[i].trim() || !/^ {2,}/.test(lines[i])) break;
    }
    if (m && m[1].length > indent) {
      const [html, next] = renderList(lines, i, image, attachments);
      if (items.length) items[items.length - 1] += html;
      i = next;
      continue;
    }
    if (m) {
      const task = /^\[([ xX])\] +(.*)$/.exec(m[3]);
      const text = task ? `${task[1] === ' ' ? '☐' : '☑'} ${task[2]}` : m[3];
      items.push(inline(escapeHtml(text), image));
    } else {
      items[items.length - 1] += ` ${inline(escapeHtml(lines[i].trim()), image)}`; // continuation line
    }
    i++;
    if (i < lines.length && !lines[i].trim() && listItem(lines[i + 1] || '')) i++; // loose list
  }
  const start1 = ordered ? Number.parseInt(first[2], 10) : 1;
  const tag = ordered ? 'ol' : 'ul';
  return [`<${tag}${ordered && start1 !== 1 ? ` start="${start1}"` : ''}>${items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`, i];
}

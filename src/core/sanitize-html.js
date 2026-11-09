/**
 * Allow-list HTML sanitizer for documentation the language server sends
 * (docstrings rendered from Markdown). Docstrings come from any installed
 * package, so they are untrusted: only formatting tags survive, never
 * scripts, event handlers, styles, forms, frames or javascript: links.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'pre', 'code', 'span', 'div', 'em', 'strong', 'b', 'i', 'u', 's', 'del', 'sub', 'sup', 'small',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'kbd',
]);
// class is kept for CodeMirror's highlighted code spans
const ALLOWED_ATTRS = { a: new Set(['href', 'title']), '*': new Set(['class']) };
const SAFE_URL = /^(https?:|mailto:|#)/i;

/**
 * @param {string} html
 * @param {Document} [doc]  a document to parse with (tests pass jsdom's)
 * @returns {string}
 */
export function sanitizeHTML(html, doc = globalThis.document) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(html ?? '');
  clean(tpl.content);
  return tpl.innerHTML;
}

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Drop dangerous elements with their content; unwrap harmless unknown ones
      if (/^(script|style|iframe|object|embed|frame|frameset|form|input|button|textarea|select|svg|math|template|link|meta|base|img|video|audio|source)$/.test(tag)) {
        child.remove();
      } else {
        clean(child);
        child.replaceWith(...child.childNodes);
      }
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      const ok = ALLOWED_ATTRS['*'].has(name) || ALLOWED_ATTRS[tag]?.has(name);
      if (!ok || (name === 'href' && !SAFE_URL.test(attr.value.trim()))) child.removeAttribute(attr.name);
    }
    if (tag === 'a') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    clean(child);
  }
}

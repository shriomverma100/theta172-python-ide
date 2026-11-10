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
// Notebook content may also show pictures stored inside it (never fetched from anywhere)
const NOTEBOOK_ATTRS = { img: new Set(['src', 'alt', 'title', 'width', 'height']), ol: new Set(['start']), td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan']) };
const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

/**
 * @param {string} html
 * @param {Document} [doc]  a document to parse with (tests pass jsdom's)
 * @param {object} [opts]
 * @param {boolean} [opts.notebook]  also keep data: pictures, list starts and table spans
 * @param {boolean} [opts.actions]   plugin panels: also keep <button data-action="name"> (clicks go to the plugin)
 * @returns {string}
 */
export function sanitizeHTML(html, doc = globalThis.document, { notebook = false, actions = false } = {}) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(html ?? '');
  clean(tpl.content, { notebook: notebook || actions, actions });
  return tpl.innerHTML;
}

const ACTION_RE = /^[\w.-]{1,64}$/;

function clean(node, opts) {
  const { notebook, actions } = opts;
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue; // text
    if (child.nodeType !== 1) { child.remove(); continue; } // comments etc.
    const tag = child.tagName.toLowerCase();
    const extra = (notebook && tag === 'img') || (actions && tag === 'button');
    if (!ALLOWED_TAGS.has(tag) && !extra) {
      // Drop dangerous elements with their content; unwrap harmless unknown ones
      if (/^(script|style|iframe|object|embed|frame|frameset|form|input|button|textarea|select|svg|math|template|link|meta|base|img|video|audio|source)$/.test(tag)) {
        child.remove();
      } else {
        clean(child, opts);
        child.replaceWith(...child.childNodes);
      }
      continue;
    }
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      const action = actions && name === 'data-action' && ACTION_RE.test(attr.value);
      const ok = action || ALLOWED_ATTRS['*'].has(name) || ALLOWED_ATTRS[tag]?.has(name) || (notebook && NOTEBOOK_ATTRS[tag]?.has(name));
      if (!ok || (name === 'href' && !SAFE_URL.test(attr.value.trim())) || (name === 'src' && !SAFE_IMAGE.test(attr.value.trim()))) child.removeAttribute(attr.name);
    }
    if (tag === 'img' && !child.hasAttribute('src')) { child.remove(); continue; }
    if (tag === 'button') child.setAttribute('type', 'button');
    if (tag === 'a') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    clean(child, opts);
  }
}

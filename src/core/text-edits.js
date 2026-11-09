/**
 * Pure helpers for applying language-server edits.
 */
import { uriKey } from './uri.js';

/** Smallest single change turning `a` into `b` (keeps the cursor near its place). */
export function minimalChange(a, b) {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) { endA--; endB--; }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}

/** Group a WorkspaceEdit's text edits by document (both `changes` and `documentChanges` forms). */
export function editsByUri(edit) {
  const out = new Map();
  if (!edit) return out;
  const add = (uri, edits) => {
    const k = uriKey(uri);
    if (!out.has(k)) out.set(k, { uri, edits: [] });
    out.get(k).edits.push(...edits);
  };
  for (const [uri, edits] of Object.entries(edit.changes || {})) add(uri, edits);
  for (const dc of edit.documentChanges || []) if (dc.textDocument && dc.edits) add(dc.textDocument.uri, dc.edits);
  return out;
}

/**
 * THETA172 — Input validation shared by the main process.
 */

'use strict';

/**
 * PyPI requirement: a name, optional extras, optional single version clause.
 * Examples: requests, requests[socks], numpy==2.1.0, pandas>=2, torch~=2.5
 * Never allows a leading '-', so it cannot be read as a pip option.
 */
const PACKAGE_SPEC = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*\])?(?:(?:===|==|!=|~=|>=|<=|>|<)[A-Za-z0-9.*+!_-]+)?$/;

function isValidPackageSpec(spec) {
  return typeof spec === 'string' && spec.length <= 200 && PACKAGE_SPEC.test(spec);
}

/**
 * Clean a short label received over the network (names, roll numbers).
 * Removes control and bidi-override characters, collapses whitespace and
 * caps the length. The UI still renders it as text, never HTML.
 */
function sanitizeLabel(value, maxLength = 64, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const clean = value
    .replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return clean || fallback;
}

/**
 * Clean free text (chat, help messages). Keeps newlines and tabs.
 */
function sanitizeText(value, maxLength = 2000) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .slice(0, maxLength);
}

module.exports = { isValidPackageSpec, sanitizeLabel, sanitizeText };

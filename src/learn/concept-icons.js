/**
 * THETA172 — an icon for each topic on "My progress".
 * Library topics show the libraries' official logos; the rest are our own
 * small line drawings (16 × 16, currentColor).
 */

import { logoSvg } from '../core/tech-logos.js';

const s = (body) => `<svg class="concept-ico" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const ICONS = {
  output: s('<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4 6l2 2-2 2M8 10h4"/>'),
  input: s('<rect x="1.5" y="4.5" width="13" height="7" rx="1.5"/><path d="M4.5 8h.01M7 6.5v3"/>'),
  variables: s('<path d="M3 3.5h10M3 8h6M3 12.5h8"/><circle cx="12.5" cy="8" r="1.2"/>'),
  arithmetic: s('<path d="M4 2.5v5M1.5 5h5M9.5 5h5M2 10.5l4 4M6 10.5l-4 4M9.5 11h5M9.5 14h5"/>'),
  strings: s('<path d="M3 5.5c0-1.5 1-2 2-2M3 5.5V8h2.5V5.5H3zM9 5.5c0-1.5 1-2 2-2M9 5.5V8h2.5V5.5H9z"/>'),
  conditions: s('<path d="M8 1.5v4M8 5.5L3.5 10v4M8 5.5l4.5 4.5v4"/>'),
  'for-loops': s('<path d="M12.5 5.5A5 5 0 1 0 13 9"/><path d="M13.5 2.5v3h-3"/>'),
  'while-loops': s('<path d="M2.5 8a5.5 3.5 0 1 0 11 0 5.5 3.5 0 1 0-11 0"/><path d="M11 3.5l2.5 1-1 2.5"/>'),
  lists: s('<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>'),
  dicts: s('<path d="M2 4h4M2 8h4M2 12h4M9 4h5M9 8h5M9 12h5"/><path d="M7 4h.5M7 8h.5M7 12h.5"/>'),
  'tuples-sets': s('<path d="M5 2.5C3 4 3 12 5 13.5M11 2.5c2 1.5 2 9.5 0 11"/><circle cx="8" cy="8" r="1"/>'),
  comprehensions: s('<path d="M4.5 2.5C3 2.5 3 4 3 5.5S2 8 1.5 8C2 8 3 8.5 3 10.5s0 3 1.5 3M11.5 2.5c1.5 0 1.5 1.5 1.5 3S14 8 14.5 8c-.5 0-1.5.5-1.5 2.5s0 3-1.5 3"/><path d="M6.5 8h3"/>'),
  functions: s('<path d="M10.5 2.5c-2 0-2.5 1-2.5 3v6c0 1.5-.5 2-2 2M5 7h6"/>'),
  recursion: s('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/><rect x="4.5" y="4.5" width="7" height="7" rx="1"/><rect x="7" y="7" width="2" height="2"/>'),
  classes: s('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M5 9h6M5 11.5h4"/>'),
  exceptions: s('<path d="M8 1.8l6.5 11.7h-13z"/><path d="M8 6v3.5M8 11.6h.01"/>'),
  files: s('<path d="M3.5 1.5h6l3 3v10h-9z"/><path d="M9.5 1.5v3h3"/>'),
};

const LOGO_TOPICS = { data: ['pandas', 'numpy'], plots: ['matplotlib'], modules: ['python'] };

/** Markup for a topic's icon(s). Trusted: built only from the tables above. */
export function conceptIcon(id) {
  if (LOGO_TOPICS[id]) return `<span class="concept-logos">${LOGO_TOPICS[id].map((l) => logoSvg(l, 16)).join('')}</span>`;
  return ICONS[id] || '';
}

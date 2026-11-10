/**
 * THETA172 — pictures for the relay setup guide.
 *
 * Simple drawings of what the teacher will see, with the thing to click
 * marked. They are drawings, not screenshots: they do not go out of date
 * when a website moves a button by a few pixels, and they follow the theme
 * (colours come from CSS variables on .rs-art).
 */

const frame = (title, body, h = 168) => `
<svg class="rs-art" viewBox="0 0 320 ${h}" role="img" aria-label="${title}">
  <rect x="1" y="1" width="318" height="${h - 2}" rx="5" class="rs-art__win"/>
  <rect x="1" y="1" width="318" height="22" rx="5" class="rs-art__bar"/>
  <rect x="1" y="17" width="318" height="6" class="rs-art__bar"/>
  <circle cx="13" cy="12" r="3.2" class="rs-art__dot"/><circle cx="24" cy="12" r="3.2" class="rs-art__dot"/><circle cx="35" cy="12" r="3.2" class="rs-art__dot"/>
  <rect x="50" y="6" width="200" height="12" rx="3" class="rs-art__url"/>
  ${body}
</svg>`;

const line = (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="6" rx="2" class="rs-art__line"/>`;
const text = (x, y, t, cls = 'rs-art__text') => `<text x="${x}" y="${y}" class="${cls}">${t}</text>`;
const field = (x, y, w, label) => `${text(x, y - 4, label, 'rs-art__small')}<rect x="${x}" y="${y}" width="${w}" height="18" rx="3" class="rs-art__field"/>`;
const button = (x, y, w, label, hot = false) => `
  <rect x="${x}" y="${y}" width="${w}" height="20" rx="3" class="${hot ? 'rs-art__btn rs-art__btn--hot' : 'rs-art__btn'}"/>
  ${text(x + w / 2, y + 13.5, label, hot ? 'rs-art__btntext rs-art__btntext--hot' : 'rs-art__btntext')}
  ${hot ? `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="28" rx="5" class="rs-art__ring"/>` : ''}`;
const cursor = (x, y) => `<path d="M${x} ${y} l0 14 l4 -3.5 l3 6.5 l2.4 -1.1 l-3 -6.4 l5.2 -0.4 z" class="rs-art__cursor"/>`;
const badge = (x, y, n) => `<circle cx="${x}" cy="${y}" r="8" class="rs-art__badge"/>${text(x, y + 3.5, String(n), 'rs-art__badgetext')}`;

export const ART = {
  signUp: frame('A sign-up page with email, password and a Sign up button', `
    ${text(110, 46, 'Create an account', 'rs-art__title')}
    ${field(90, 62, 140, 'Email')}
    ${field(90, 98, 140, 'Password')}
    ${button(90, 128, 140, 'Sign up', true)}
    ${cursor(196, 140)}
    ${badge(78, 72, 1)}${badge(78, 108, 2)}${badge(78, 138, 3)}`),

  verify: frame('An email inbox with a Verify email button', `
    ${line(20, 36, 70)}${line(20, 50, 56)}${line(20, 64, 64)}
    <rect x="104" y="30" width="200" height="124" rx="4" class="rs-art__card"/>
    ${text(118, 52, 'Verify your email', 'rs-art__title')}
    ${line(118, 62, 160)}${line(118, 74, 130)}
    ${button(118, 92, 110, 'Verify email', true)}
    ${cursor(196, 104)}`),

  createToken: frame('The API tokens page with a Create Token button', `
    ${text(20, 46, 'User API Tokens', 'rs-art__title')}
    ${line(20, 56, 180)}
    ${button(214, 34, 92, 'Create Token', true)}
    ${cursor(282, 46)}
    <rect x="20" y="78" width="286" height="72" rx="4" class="rs-art__card"/>
    ${line(34, 92, 120)}${line(34, 108, 90)}${line(34, 124, 140)}`),

  template: frame('A list of templates; Use template is marked on the Edit Cloudflare Workers row', `
    ${text(20, 44, 'API token templates', 'rs-art__title')}
    <rect x="20" y="54" width="286" height="26" rx="3" class="rs-art__row"/>
    ${text(30, 71, 'Read analytics and logs', 'rs-art__small')}${button(236, 57, 62, 'Use template')}
    <rect x="20" y="84" width="286" height="26" rx="3" class="rs-art__row rs-art__row--hot"/>
    ${text(30, 101, 'Edit Cloudflare Workers', 'rs-art__text')}${button(236, 87, 62, 'Use template', true)}
    ${cursor(278, 100)}
    <rect x="20" y="114" width="286" height="26" rx="3" class="rs-art__row"/>
    ${text(30, 131, 'Read billing info', 'rs-art__small')}${button(236, 117, 62, 'Use template')}`, 150),

  resources: frame('Choose your account and All zones, then Continue to summary', `
    ${text(20, 44, 'Account Resources', 'rs-art__small')}
    <rect x="20" y="50" width="62" height="18" rx="3" class="rs-art__field"/>${text(28, 62, 'Include', 'rs-art__small')}
    <rect x="88" y="50" width="130" height="18" rx="3" class="rs-art__field rs-art__field--hot"/>${text(96, 62, 'Your account', 'rs-art__text')}
    ${badge(232, 59, 1)}
    ${text(20, 88, 'Zone Resources', 'rs-art__small')}
    <rect x="20" y="94" width="62" height="18" rx="3" class="rs-art__field"/>${text(28, 106, 'Include', 'rs-art__small')}
    <rect x="88" y="94" width="130" height="18" rx="3" class="rs-art__field rs-art__field--hot"/>${text(96, 106, 'All zones', 'rs-art__text')}
    ${badge(232, 103, 2)}
    ${button(186, 128, 120, 'Continue to summary', true)}
    ${badge(174, 138, 3)}
    ${cursor(290, 140)}`),

  copyToken: frame('The new token is shown once with a Copy button', `
    ${text(20, 46, 'Your token was created', 'rs-art__title')}
    ${line(20, 56, 220)}
    <rect x="20" y="72" width="216" height="22" rx="3" class="rs-art__field rs-art__field--hot"/>
    ${text(30, 87, 'aB3x•••••••••••••••••••••Qz', 'rs-art__mono')}
    ${button(244, 73, 62, 'Copy', true)}
    ${cursor(282, 86)}
    ${line(20, 112, 250)}${line(20, 124, 200)}
    ${text(20, 146, 'Shown only once: copy it now.', 'rs-art__warn')}`),

  appPaste: `
<svg class="rs-art" viewBox="0 0 320 120" role="img" aria-label="Paste the token into the app and press Set up the relay">
  <rect x="1" y="1" width="318" height="118" rx="5" class="rs-art__win rs-art__win--app"/>
  ${text(18, 28, 'Python by THETA172', 'rs-art__small')}
  ${field(18, 48, 284, 'Cloudflare API token')}
  ${text(28, 61, 'Ctrl + V', 'rs-art__mono')}
  ${button(18, 82, 140, 'Set up the relay', true)}
  ${cursor(130, 94)}
</svg>`,

  howItWorks: `
<svg class="rs-art rs-art--wide" viewBox="0 0 520 132" role="img" aria-label="The teacher and the students each connect out to the relay; the relay passes messages between them">
  <rect x="190" y="40" width="140" height="52" rx="6" class="rs-art__relay"/>
  <text x="260" y="62" class="rs-art__title" text-anchor="middle">Your relay</text>
  <text x="260" y="79" class="rs-art__small" text-anchor="middle">on Cloudflare, free</text>
  <rect x="14" y="44" width="118" height="44" rx="5" class="rs-art__card"/>
  <text x="73" y="64" class="rs-art__text" text-anchor="middle">Teacher</text>
  <text x="73" y="79" class="rs-art__small" text-anchor="middle">school Wi-Fi</text>
  <g class="rs-art__students">
    <rect x="388" y="6" width="118" height="34" rx="5" class="rs-art__card"/><text x="447" y="27" class="rs-art__small" text-anchor="middle">Student · home</text>
    <rect x="388" y="49" width="118" height="34" rx="5" class="rs-art__card"/><text x="447" y="70" class="rs-art__small" text-anchor="middle">Student · mobile data</text>
    <rect x="388" y="92" width="118" height="34" rx="5" class="rs-art__card"/><text x="447" y="113" class="rs-art__small" text-anchor="middle">Student · lab</text>
  </g>
  <path d="M132 66 H190" class="rs-art__link"/>
  <path d="M330 60 C356 60 360 23 388 23" class="rs-art__link"/>
  <path d="M330 66 H388" class="rs-art__link"/>
  <path d="M330 72 C356 72 360 109 388 109" class="rs-art__link"/>
</svg>`,
};

/** Small line icons for the three ways to join (24 × 24, currentColor). */
export const JOIN_ICONS = {
  wifi: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.2a9.5 9.5 0 0 1 13 0M8.6 15.3a5 5 0 0 1 6.8 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="18.6" r="1.5" fill="currentColor"/></svg>',
  relay: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9M12 3c-2.6 2.6-3.8 5.6-3.8 9s1.2 6.4 3.8 9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  setup: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 14.5l4.5-4.5 3 3L19 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 5.5H19V10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 18.5h10.2a4.3 4.3 0 0 0 .5-8.6A6 6 0 0 0 6.3 11a3.8 3.8 0 0 0 .7 7.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  docker: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 12.5h16.5c.6-1 1.6-1.6 2.5-1.6-.3-1-1-1.6-1.9-1.8-.4 1.2-1.3 1.9-2.6 1.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 12.5c0 4.2 3.2 6.5 7.6 6.5 4.9 0 8.2-2.6 9.4-6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 9h2.6v3.5M8.1 9h2.6v3.5M10.7 9h2.6v3.5M8.1 5.5h2.6V9M10.7 5.5h2.6V9M13.3 9h2.6v3.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  pc: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 20h6M12 16v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  open: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

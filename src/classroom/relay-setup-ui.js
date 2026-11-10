/**
 * THETA172 — "Set up your school's relay": a step-by-step guide inside the app.
 *
 * Three ways, one window:
 *   Cloudflare (recommended, free) · Docker (a school server) · This computer
 *
 * The guide checks this computer first (internet, Docker) and links to what
 * is missing. When a relay works, its address is saved as the school relay
 * and the teacher's class uses it.
 */

import { ART, JOIN_ICONS } from './relay-art.js';
import { showToast } from '../toast.js';
import { logoSvg } from '../core/tech-logos.js';

const api = () => window.electronAPI;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const html = (tag, cls, markup) => { const e = el(tag, cls); e.innerHTML = markup; return e; }; // static markup only
const button = (cls, label, onClick, icon) => {
  const b = el('button', cls);
  b.type = 'button';
  if (icon) b.append(html('span', 'rs-btn__icon', icon));
  b.append(el('span', '', label));
  b.addEventListener('click', onClick);
  return b;
};
const linkButton = (label, key) => button('rs-btn rs-btn--link', label, () => api()?.relayOpenLink?.(key), JOIN_ICONS.open);

const CF_STEPS = [
  ['token', 'Check the token and find your account'],
  ['subdomain', 'Get your free workers.dev address'],
  ['upload', 'Upload the class relay'],
  ['enable', 'Switch the address on'],
  ['test', 'Run a test class through it'],
];

let overlay = null;
let onSavedCb = null;

/**
 * Open the guide.
 * @param {{ onSaved?: (url: string) => void, tab?: 'cloudflare'|'docker'|'pc' }} [opts]
 */
export function openRelaySetup(opts = {}) {
  onSavedCb = opts.onSaved || null;
  closeRelaySetup();
  overlay = el('div', 'rs-overlay');
  const box = el('section', 'rs-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'rs-title');

  const head = el('header', 'rs-head');
  const titles = el('div', 'rs-head__titles');
  const h = el('h2', 'rs-title', "Set up your school's relay");
  h.id = 'rs-title';
  titles.append(h, el('p', 'rs-sub', 'Once for the whole school. After this, students join your classes from any internet connection.'));
  const close = button('rs-close', '', closeRelaySetup, JOIN_ICONS.cross);
  close.setAttribute('aria-label', 'Close');
  close.title = 'Close (Esc)';
  head.append(titles, close);

  const tabs = el('div', 'rs-tabs');
  tabs.setAttribute('role', 'tablist');
  const body = el('div', 'rs-body');
  const panes = {
    cloudflare: cloudflarePane(),
    docker: dockerPane(),
    pc: pcPane(),
  };
  const tabDefs = [
    ['cloudflare', 'Cloudflare', 'Recommended · free', logoSvg('cloudflare', 22)],
    ['docker', 'Docker', 'A school server', logoSvg('docker', 22)],
    ['pc', 'This computer', 'Inside the school only', JOIN_ICONS.pc],
  ];
  const select = (key) => {
    for (const t of tabs.children) {
      const on = t.dataset.tab === key;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== key;
    body.scrollTop = 0;
  };
  for (const [key, label, hint, icon] of tabDefs) {
    const t = el('button', 'rs-tab');
    t.type = 'button';
    t.dataset.tab = key;
    t.setAttribute('role', 'tab');
    t.append(html('span', 'rs-tab__icon', icon));
    const words = el('span', 'rs-tab__words');
    words.append(el('b', '', label), el('small', '', hint));
    t.append(words);
    t.addEventListener('click', () => select(key));
    tabs.append(t);
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = [...tabs.children];
    const i = list.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    next.click();
    next.focus();
  });

  body.append(...Object.values(panes));
  box.append(head, tabs, body);
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeRelaySetup(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeRelaySetup(); } });
  document.body.append(overlay);
  select(opts.tab || 'cloudflare');
  tabs.querySelector('[aria-selected="true"]')?.focus();
  runChecks();
}

export function closeRelaySetup() {
  overlay?.remove();
  overlay = null;
}

function saved(url, how) {
  onSavedCb?.(url);
  showToast(`Relay saved (${how}). Your classes now use it.`, 'success', 3500);
}

// ── Checks shown at the top of each way ────────────────────────────
const checks = { internet: null, docker: null, campus: null, cloudflare: null };
const checkRows = new Set();

async function runChecks() {
  const r = await api()?.relaySetupCheck?.().catch(() => null);
  if (!r) return;
  Object.assign(checks, r);
  for (const fn of checkRows) fn();
}

function checkRow(label, getState) {
  const row = el('li', 'rs-check');
  const icon = el('span', 'rs-check__icon');
  const words = el('span', 'rs-check__words');
  const extra = el('span', 'rs-check__extra');
  row.append(icon, words, extra);
  const paint = () => {
    const s = getState();
    row.className = `rs-check is-${s.state}`;
    icon.innerHTML = s.state === 'ok' ? JOIN_ICONS.check : s.state === 'bad' ? JOIN_ICONS.cross : '';
    words.replaceChildren(el('b', '', label), el('span', '', s.note || ''));
    extra.replaceChildren(...(s.actions || []));
  };
  checkRows.add(paint);
  paint();
  return row;
}

const internetState = () => {
  if (!checks.internet) return { state: 'wait', note: 'Checking…' };
  return checks.internet.ok ? { state: 'ok', note: 'Connected' } : { state: 'bad', note: checks.internet.message || 'Not connected' };
};

// ── Cloudflare ────────────────────────────────────────────────────
function step(n, title, ...content) {
  const s = el('li', 'rs-step');
  const num = el('span', 'rs-step__num', String(n));
  const main = el('div', 'rs-step__main');
  main.append(el('h3', 'rs-step__title', title), ...content);
  s.append(num, main);
  return s;
}
const para = (text) => el('p', 'rs-p', text);
const art = (markup) => html('figure', 'rs-figure', markup);
const list = (items) => {
  const ol = el('ol', 'rs-list');
  for (const it of items) { const li = el('li'); li.innerHTML = it; ol.append(li); } // static text with <b>
  return ol;
};

function cloudflarePane() {
  const pane = el('div', 'rs-pane');
  pane.setAttribute('role', 'tabpanel');
  pane.append(
    art(ART.howItWorks),
    el('p', 'rs-lead', 'Cloudflare runs your relay on its network for free. Classes start in under a second, each class gets its own little server, and nothing is installed on this computer. It takes about 10 minutes, once.'),
  );

  const need = el('ul', 'rs-checks');
  need.append(
    checkRow('Internet', internetState),
    checkRow('A Cloudflare account', () => ({ state: 'todo', note: 'Free. No card needed.', actions: [linkButton('Sign up', 'signUp')] })),
    checkRow('An API token', () => (checks.cloudflare?.tokenSaved
      ? { state: 'ok', note: 'Saved on this computer (encrypted)' }
      : { state: 'todo', note: 'Steps 2–3 below show how.', actions: [linkButton('Tokens page', 'tokens')] })),
  );
  pane.append(el('h3', 'rs-h', 'What you need'), need);

  // Step 3: paste + go
  const tokenInput = el('input', 'rs-input rs-input--mono');
  tokenInput.type = 'password';
  tokenInput.id = 'rs-cf-token';
  tokenInput.placeholder = 'Paste the token here (Ctrl + V)';
  tokenInput.autocomplete = 'off';
  tokenInput.spellcheck = false;
  tokenInput.maxLength = 400;
  const show = el('label', 'rs-inline');
  const showBox = el('input');
  showBox.type = 'checkbox';
  showBox.addEventListener('change', () => { tokenInput.type = showBox.checked ? 'text' : 'password'; });
  show.append(showBox, el('span', '', 'Show'));
  const tokenRow = el('div', 'rs-row');
  tokenRow.append(tokenInput, show);

  const remember = el('label', 'rs-inline');
  const rememberBox = el('input');
  rememberBox.type = 'checkbox';
  remember.append(rememberBox, el('span', '', 'Remember the token on this computer (encrypted by Windows) so I can update the relay later'));

  const nameInput = el('input', 'rs-input');
  nameInput.id = 'rs-cf-name';
  nameInput.placeholder = 'e.g. dps-noida';
  nameInput.maxLength = 40;
  nameInput.spellcheck = false;
  const nameGroup = el('details', 'rs-more');
  nameGroup.append(el('summary', '', 'Choose the address name (optional)'),
    para('Used only if your Cloudflare account has no workers.dev address yet. Letters, numbers and dashes. Your relay will be theta172-relay.<name>.workers.dev.'),
    nameInput);

  const progress = el('ol', 'rs-progress');
  progress.hidden = true;
  const result = el('div', 'rs-result');
  result.hidden = true;
  const go = button('rs-btn rs-btn--primary', 'Set up the relay', () => deploy());
  go.id = 'rs-cf-go';

  const paintProgress = (states) => {
    progress.replaceChildren();
    for (const [id, label] of CF_STEPS) {
      const s = states[id] || { state: 'todo' };
      const li = el('li', `rs-prog is-${s.state}`);
      li.append(html('span', 'rs-prog__icon', s.state === 'ok' ? JOIN_ICONS.check : s.state === 'fail' ? JOIN_ICONS.cross : ''),
        el('span', 'rs-prog__label', label), el('span', 'rs-prog__note', s.note || ''));
      progress.append(li);
    }
  };

  const deploy = async () => {
    const token = tokenInput.value.trim();
    if (!token && !checks.cloudflare?.tokenSaved) { tokenInput.focus(); showToast('Paste your Cloudflare API token first.', 'error', 3000); return; }
    const states = {};
    paintProgress(states);
    progress.hidden = false;
    result.hidden = true;
    go.disabled = true;
    go.querySelector('span:last-child').textContent = 'Setting up…';
    const off = api()?.onRelaySetupStep?.((s) => { states[s.id] = s; paintProgress(states); });
    let r;
    try {
      r = await api().relayCfDeploy({ token, remember: rememberBox.checked, subdomain: nameInput.value.trim() });
    } catch (err) {
      r = { ok: false, message: err.message };
    }
    if (typeof off === 'function') off();
    go.disabled = false;
    go.querySelector('span:last-child').textContent = 'Set up the relay';
    tokenInput.value = '';
    showResult(r);
    if (rememberBox.checked) runChecks();
  };

  const showResult = (r) => {
    result.hidden = false;
    result.replaceChildren();
    if (r.ok) {
      result.className = 'rs-result is-ok';
      result.append(el('h3', 'rs-result__title', 'Your relay is ready'),
        para('This address is now your school relay. Give it to the other teachers: they choose "Our school\'s relay" and paste it.'),
        addressRow(r.url));
      saved(r.url, 'Cloudflare');
    } else if (r.url) {
      // Uploaded, but the test did not pass yet (a new address takes a few minutes)
      result.className = 'rs-result is-wait';
      result.append(el('h3', 'rs-result__title', 'Almost there'),
        para(`The relay is uploaded, but Cloudflare has not switched the address on yet (${r.test?.message || 'no answer'}). A brand-new address can take up to 10 minutes. Press "Test again" in a few minutes.`),
        addressRow(r.url, true));
    } else {
      result.className = 'rs-result is-fail';
      result.append(el('h3', 'rs-result__title', 'That did not work'), para(r.message || 'Something went wrong.'),
        para('Most often the token was made from a different template, or only part of it was copied. Make a new token (steps 2–3) and try again.'));
    }
  };

  const steps = el('ol', 'rs-steps');
  steps.append(
    step(1, 'Make a free Cloudflare account',
      para('Open the sign-up page, enter an email and a password, then open the email Cloudflare sends you and press Verify. A school email is best, so the school keeps the account.'),
      el('div', 'rs-figs', undefined),
      el('div', 'rs-actions')),
    step(2, 'Make an API token',
      para('A token lets this app set up the relay on your account, and nothing else you do not allow.'),
      list([
        'Open the <b>API Tokens</b> page and press <b>Create Token</b>.',
        'Next to <b>Edit Cloudflare Workers</b>, press <b>Use template</b>.',
        'Under <b>Account Resources</b> choose your account. Under <b>Zone Resources</b> choose <b>All zones</b>.',
        'Press <b>Continue to summary</b>, then <b>Create Token</b>.',
        'Press <b>Copy</b>. Cloudflare shows the token only once.',
      ]),
      el('div', 'rs-figs', undefined),
      el('div', 'rs-actions')),
    step(3, 'Paste the token and set up',
      art(ART.appPaste), tokenRow, remember, nameGroup, el('div', 'rs-actions rs-actions--go'), progress, result),
  );
  const [s1, s2, s3] = steps.children;
  s1.querySelector('.rs-figs').append(art(ART.signUp), art(ART.verify));
  s1.querySelector('.rs-actions').append(linkButton('Open Cloudflare sign-up', 'signUp'));
  s2.querySelector('.rs-figs').append(art(ART.createToken), art(ART.template), art(ART.resources), art(ART.copyToken));
  s2.querySelector('.rs-actions').append(linkButton('Open the API Tokens page', 'tokens'));
  s3.querySelector('.rs-actions--go').append(go);

  pane.append(el('h3', 'rs-h', 'Steps'), steps,
    html('p', 'rs-note', 'Free plan: roughly 20 class-hours a day for the whole school (for example 4 classes of 5 hours), up to 200 students in a class. Limits reset every day at 05:30 India time. A school with many classes at once can switch on Cloudflare\'s $5 a month plan; nothing changes in the app.'));
  return pane;
}

/** The relay address with Copy and Test. */
function addressRow(url, testFirst = false) {
  const row = el('div', 'rs-address');
  const code = el('code', 'rs-address__url', url);
  const copy = button('rs-btn', 'Copy', async () => {
    try { await navigator.clipboard.writeText(url); showToast('Address copied', 'success', 1500); } catch (_) { /* no clipboard */ }
  });
  const status = el('span', 'rs-address__status');
  const test = button('rs-btn', testFirst ? 'Test again' : 'Test', async () => {
    status.textContent = 'Testing…';
    status.className = 'rs-address__status';
    const r = await api()?.relayTest?.(url).catch((e) => ({ ok: false, message: e.message }));
    status.textContent = r?.ok ? `Works (${r.ms} ms)` : r?.message || 'No answer';
    status.className = `rs-address__status ${r?.ok ? 'is-ok' : 'is-bad'}`;
    if (r?.ok && testFirst) saved(url, 'Cloudflare');
  });
  row.append(code, copy, test, status);
  return row;
}

// ── Docker ────────────────────────────────────────────────────────
function dockerPane() {
  const pane = el('div', 'rs-pane');
  pane.setAttribute('role', 'tabpanel');
  pane.append(
    el('p', 'rs-lead', 'Run the relay in Docker on a computer the school keeps switched on. Students outside the school can reach it only if that computer has a public internet address (a cloud server, or a school server your IT team has opened to the internet with HTTPS). On an ordinary school PC it works inside the school network only.'),
  );
  const dockerState = () => {
    const d = checks.docker;
    if (!d) return { state: 'wait', note: 'Checking…' };
    if (!d.installed) return { state: 'bad', note: 'Not installed', actions: [linkButton('Download Docker Desktop', 'docker'), linkButton('Install guide', 'dockerWindows')] };
    if (!d.running) return { state: 'bad', note: `Installed (${d.version}) but not running. Open Docker Desktop and wait for "Engine running".`, actions: [button('rs-btn', 'Check again', () => runChecks())] };
    return { state: 'ok', note: `Docker ${d.version} is running${d.container ? ` · relay: ${d.container.status}` : ''}` };
  };
  const need = el('ul', 'rs-checks');
  need.append(checkRow('Docker Desktop', dockerState));
  pane.append(el('h3', 'rs-h', 'What you need'), need);

  const log = el('pre', 'rs-log');
  log.hidden = true;
  const result = el('div', 'rs-result');
  result.hidden = true;
  const start = button('rs-btn rs-btn--primary', 'Build and start the relay', async () => {
    log.hidden = false;
    log.textContent = '';
    result.hidden = true;
    start.disabled = true;
    const off = api()?.onRelaySetupLog?.((line) => { log.textContent += `${line}\n`; log.scrollTop = log.scrollHeight; });
    const r = await api().relayDockerStart().catch((e) => ({ ok: false, message: e.message }));
    if (typeof off === 'function') off();
    start.disabled = false;
    runChecks();
    result.hidden = false;
    result.replaceChildren();
    if (!r.ok) {
      result.className = 'rs-result is-fail';
      result.append(el('h3', 'rs-result__title', 'That did not work'), para(r.message || 'See the log.'));
      return;
    }
    result.className = 'rs-result is-ok';
    result.append(el('h3', 'rs-result__title', 'The relay is running in Docker'),
      para('It starts again by itself when the computer restarts. Choose the address students can reach:'),
      addressList(r.urls, 'Docker'),
      para('If your IT team puts it behind HTTPS (for example relay.your-school.in), use wss://relay.your-school.in instead.'));
  });
  const stop = button('rs-btn', 'Stop and remove', async () => { await api()?.relayDockerStop?.(); runChecks(); showToast('Docker relay stopped', 'info', 2000); });
  const folder = button('rs-btn', 'Open the relay folder', () => api()?.relayDockerFolder?.());

  const steps = el('ol', 'rs-steps');
  steps.append(
    step(1, 'Install Docker Desktop', para('Download it, run the installer and restart when it asks. On Windows it may also ask to install WSL: say yes.'),
      actions(linkButton('Download Docker Desktop', 'docker'), linkButton('Windows install guide', 'dockerWindows'), linkButton('About WSL', 'wsl'))),
    step(2, 'Start Docker Desktop', para('Open it from the Start menu and wait until the bottom-left corner says "Engine running". Then press Check again above.')),
    step(3, 'Start the relay', para('The app writes the relay files, builds a small image (the first time downloads about 50 MB) and starts it on port 8787.'),
      actions(start, stop, folder), log, result),
  );
  pane.append(el('h3', 'rs-h', 'Steps'), steps,
    html('p', 'rs-note', 'On a cloud server without this app: copy the relay folder there and run <code>docker build -t theta172-relay .</code> then <code>docker run -d --restart unless-stopped -p 8787:8787 theta172-relay</code>.'));
  return pane;
}

const actions = (...btns) => { const a = el('div', 'rs-actions'); a.append(...btns); return a; };

function addressList(urls, how) {
  const box = el('div', 'rs-addresses');
  if (!urls?.length) { box.append(para('This computer has no network address right now.')); return box; }
  for (const u of urls) {
    const row = el('div', 'rs-address');
    row.append(el('code', 'rs-address__url', u.url), el('span', 'rs-address__where', u.name),
      button('rs-btn', 'Use this', () => saved(u.url, how)));
    box.append(row);
  }
  return box;
}

// ── This computer ─────────────────────────────────────────────────
function pcPane() {
  const pane = el('div', 'rs-pane');
  pane.setAttribute('role', 'tabpanel');
  pane.append(el('p', 'rs-lead', 'The relay runs inside this app while it is open. Use it when computers in the school are on different networks (Wi-Fi and lab cables, separate floors) and students cannot find the class by themselves. It does not reach students at home: for that, use Cloudflare.'));

  const result = el('div', 'rs-result');
  result.hidden = true;
  const paint = (r) => {
    result.hidden = false;
    result.replaceChildren();
    if (!r.ok) { result.className = 'rs-result is-fail'; result.append(para(r.message || 'Could not start.')); return; }
    result.className = 'rs-result is-ok';
    result.append(el('h3', 'rs-result__title', 'The relay is running on this computer'),
      para('Pick the address of the network your students are on. Keep this app open during class.'),
      addressList(r.urls, 'this computer'));
  };
  const start = button('rs-btn rs-btn--primary', 'Start the relay on this computer', async () => {
    const r = await api().relayCampusStart().catch((e) => ({ ok: false, message: e.message }));
    paint(r);
    runChecks();
  });
  const stop = button('rs-btn', 'Stop', async () => { await api()?.relayCampusStop?.(); result.hidden = true; runChecks(); });
  const state = () => (checks.campus?.running ? { state: 'ok', note: `Running on port ${checks.campus.port}` } : { state: 'todo', note: 'Not running' });
  const need = el('ul', 'rs-checks');
  need.append(checkRow('Relay on this computer', state));
  pane.append(need,
    el('ol', 'rs-steps'));
  pane.lastChild.append(
    step(1, 'Start it', para('Windows may ask whether to allow the app on networks. Choose Allow for private networks (school networks count).'), actions(start, stop), result),
    step(2, 'Students paste the invite', para('Your class invite then includes this computer\'s address, so students paste the whole invite into the class code box.')),
  );
  return pane;
}

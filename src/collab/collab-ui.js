/**
 * THETA172 — Collab UI Component Builders
 * Pure DOM creation functions — no innerHTML for security.
 * Each function returns a real DOM element.
 *
 * Design: Editorial Brutalist matching reference image.
 * Palette: #EAEAE8 / #111111 / #FF3300 only.
 */


// ── SVG ICON FACTORY ──────────────────────────────────────────────
// Creates SVG elements with proper namespace handling.

function createSVG(width, height, viewBox, paths) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');

  paths.forEach((p) => {
    const el = document.createElementNS(ns, p.tag || 'path');
    Object.entries(p.attrs).forEach(([key, val]) => {
      el.setAttribute(key, val);
    });
    svg.appendChild(el);
  });

  return svg;
}


// ── ICONS ─────────────────────────────────────────────────────────

function iconArrowLeft() {
  return createSVG(14, 14, '0 0 14 14', [
    { attrs: { d: 'M9 3L5 7L9 11', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
  ]);
}

function iconArrowRight() {
  return createSVG(16, 16, '0 0 16 16', [
    { attrs: { d: 'M6 4L10 8L6 12', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
  ]);
}

function iconBroadcast() {
  return createSVG(28, 28, '0 0 28 28', [
    { tag: 'circle', attrs: { cx: '14', cy: '14', r: '4', stroke: 'currentColor', 'stroke-width': '1.8' } },
    { attrs: { d: 'M8 8a9 9 0 0 1 12 0', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' } },
    { attrs: { d: 'M20 20a9 9 0 0 1-12 0', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' } },
    { attrs: { d: 'M5 5a14 14 0 0 1 18 0', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', opacity: '0.4' } },
    { attrs: { d: 'M23 23a14 14 0 0 1-18 0', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', opacity: '0.4' } },
  ]);
}

function iconEye() {
  return createSVG(28, 28, '0 0 28 28', [
    { attrs: { d: 'M2 14C2 14 6 6 14 6s12 8 12 8-4 8-12 8S2 14 2 14Z', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linejoin': 'round' } },
    { tag: 'circle', attrs: { cx: '14', cy: '14', r: '4', stroke: 'currentColor', 'stroke-width': '1.8' } },
    { tag: 'circle', attrs: { cx: '14', cy: '14', r: '1.5', fill: 'currentColor' } },
  ]);
}

function iconCopy() {
  return createSVG(12, 12, '0 0 12 12', [
    { tag: 'rect', attrs: { x: '3.5', y: '3.5', width: '7', height: '7', rx: '1', stroke: 'currentColor', 'stroke-width': '1.1' } },
    { attrs: { d: 'M3.5 3.5V2A1 1 0 012 1H1M1 1V8A1 1 0 002 9H3.5', stroke: 'currentColor', 'stroke-width': '1.1', 'stroke-linecap': 'round' } },
  ]);
}

function iconSignal() {
  return createSVG(14, 14, '0 0 14 14', [
    { tag: 'circle', attrs: { cx: '7', cy: '7', r: '2', fill: 'currentColor' } },
    { attrs: { d: 'M4 4a5 5 0 0 1 6 0', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' } },
    { attrs: { d: 'M10 10a5 5 0 0 1-6 0', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' } },
    { attrs: { d: 'M2 2a9 9 0 0 1 10 0', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linecap': 'round', opacity: '0.4' } },
    { attrs: { d: 'M12 12a9 9 0 0 1-10 0', stroke: 'currentColor', 'stroke-width': '1', 'stroke-linecap': 'round', opacity: '0.4' } },
  ]);
}

function iconLive() {
  return createSVG(16, 16, '0 0 16 16', [
    { tag: 'circle', attrs: { cx: '8', cy: '8', r: '3', fill: '#FF3300' } },
    { tag: 'circle', attrs: { cx: '8', cy: '8', r: '6', stroke: '#FF3300', 'stroke-width': '1.2', opacity: '0.4' } },
  ]);
}

function iconDisconnect() {
  return createSVG(12, 12, '0 0 12 12', [
    { attrs: { d: 'M3 3L9 9M9 3L3 9', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' } },
  ]);
}

function iconConnect() {
  return createSVG(14, 14, '0 0 14 14', [
    { attrs: { d: 'M5 9L2 12', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' } },
    { attrs: { d: 'M9 5L12 2', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round' } },
    { attrs: { d: 'M5 9L9 5', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' } },
    { tag: 'circle', attrs: { cx: '5', cy: '9', r: '1.5', fill: 'currentColor' } },
    { tag: 'circle', attrs: { cx: '9', cy: '5', r: '1.5', fill: 'currentColor' } },
  ]);
}

function iconEyeSmall() {
  return createSVG(14, 14, '0 0 14 14', [
    { attrs: { d: 'M1 7C1 7 3 3 7 3s6 4 6 4-2 4-6 4S1 7 1 7Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' } },
    { tag: 'circle', attrs: { cx: '7', cy: '7', r: '2', stroke: 'currentColor', 'stroke-width': '1.2' } },
  ]);
}


// ── HELPER: Create Element with Class + Text ──────────────────────

function el(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

function elWithChildren(tag, className, children) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  children.forEach((child) => {
    if (child) element.appendChild(child);
  });
  return element;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Top Navigation Bar
// ══════════════════════════════════════════════════════════════════

export function buildTopbar(onBack) {
  const topbar = el('div', 'collab-topbar');

  // Left side — back button
  const left = el('div', 'collab-topbar__left');

  const backBtn = el('button', 'collab-back-btn');
  backBtn.title = 'Back to IDE';
  backBtn.appendChild(iconArrowLeft());
  const backText = el('span', null, 'Back to IDE');
  backBtn.appendChild(backText);
  backBtn.addEventListener('click', onBack);

  left.appendChild(backBtn);

  // Right side — brand + version
  const right = el('div', 'collab-topbar__right');

  const brand = el('span', 'collab-brand', 'THETA172 COLLAB');
  const version = el('span', 'collab-version', 'V1.0');

  right.appendChild(brand);
  right.appendChild(version);

  topbar.appendChild(left);
  topbar.appendChild(right);

  return topbar;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Hero Section — "collab." large text + red accent block
// ══════════════════════════════════════════════════════════════════

export function buildHeroSection(onScrollToRoles) {
  const hero = el('div', 'collab-hero');

  // ── Left side: text content ──
  const left = el('div', 'collab-hero__left');

  const label = el('span', 'collab-hero__label', 'THETA172 COLLABORATIVE');

  const title = el('h1', 'collab-hero__title', 'collab.');

  const subtitle = el('div', 'collab-hero__subtitle');
  subtitle.innerHTML = ''; // No innerHTML — build line by line
  const line1 = el('div', null, 'COLLABORATIVE CODE SHARING · LIVE VIEW');
  const line2 = el('div', null, 'ZERO CONFIG · INSTANT CONNECT');
  const line3 = el('div', null, 'CLASSROOM READY');
  subtitle.appendChild(line1);
  subtitle.appendChild(line2);
  subtitle.appendChild(line3);

  const number = el('span', 'collab-hero__number', '001');

  left.appendChild(label);
  left.appendChild(title);
  left.appendChild(subtitle);
  left.appendChild(number);

  // ── Right side: red accent block + illustration ──
  const right = el('div', 'collab-hero__right');

  const accent = el('div', 'collab-hero__accent');

  // Illustration — connection diagram using SVG
  const graphic = el('div', 'collab-hero__graphic');
  const illustration = buildConnectionIllustration();
  graphic.appendChild(illustration);

  // Vertical text
  const verticalText = el('span', 'collab-hero__vertical-text',
    'COLLABORATIVE CODING PLATFORM 2025');

  // Three dots
  const dots = el('div', 'collab-hero__dots');
  for (let i = 0; i < 3; i++) {
    dots.appendChild(el('span', 'collab-hero__dot'));
  }

  // Arrow button
  const arrowBtn = el('button', 'collab-hero__arrow');
  arrowBtn.title = 'Get started';
  arrowBtn.appendChild(iconArrowRight());
  arrowBtn.addEventListener('click', onScrollToRoles);

  right.appendChild(accent);
  right.appendChild(graphic);
  right.appendChild(verticalText);
  right.appendChild(dots);
  right.appendChild(arrowBtn);

  hero.appendChild(left);
  hero.appendChild(right);

  return hero;
}

/**
 * Build the connection illustration SVG for the hero section.
 * Shows three laptops connected by lines to a central node.
 */
function buildConnectionIllustration() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '240');
  svg.setAttribute('height', '180');
  svg.setAttribute('viewBox', '0 0 240 180');
  svg.setAttribute('fill', 'none');
  svg.classList.add('collab-hero__illustration');

  // Central hub
  const hub = document.createElementNS(ns, 'circle');
  hub.setAttribute('cx', '120');
  hub.setAttribute('cy', '90');
  hub.setAttribute('r', '16');
  hub.setAttribute('fill', '#111111');
  svg.appendChild(hub);

  const hubInner = document.createElementNS(ns, 'circle');
  hubInner.setAttribute('cx', '120');
  hubInner.setAttribute('cy', '90');
  hubInner.setAttribute('r', '6');
  hubInner.setAttribute('fill', '#FF3300');
  svg.appendChild(hubInner);

  // Connection nodes
  const nodes = [
    { x: 40,  y: 40,  label: 'T' },
    { x: 200, y: 40,  label: 'S1' },
    { x: 40,  y: 140, label: 'S2' },
    { x: 200, y: 140, label: 'S3' },
  ];

  nodes.forEach((node) => {
    // Connection line
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(node.x));
    line.setAttribute('y1', String(node.y));
    line.setAttribute('x2', '120');
    line.setAttribute('y2', '90');
    line.setAttribute('stroke', '#EAEAE8');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4 3');
    line.setAttribute('opacity', '0.6');
    svg.appendChild(line);

    // Node circle
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y));
    circle.setAttribute('r', '12');
    circle.setAttribute('fill', '#EAEAE8');
    circle.setAttribute('stroke', '#111111');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);

    // Node label
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(node.x));
    text.setAttribute('y', String(node.y + 4));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui, sans-serif');
    text.setAttribute('font-weight', '800');
    text.setAttribute('font-size', '8');
    text.setAttribute('fill', '#111111');
    text.textContent = node.label;
    svg.appendChild(text);
  });

  return svg;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Role Selection Cards — Share / View
// ══════════════════════════════════════════════════════════════════

export function buildRoleCards(onSelectRole) {
  const container = el('div', 'collab-roles');
  container.id = 'collab-roles';

  // ── SHARE CARD ──
  const shareCard = el('button', 'collab-role-card');
  shareCard.id = 'collab-role-share';
  shareCard.setAttribute('data-role', 'sharer');

  const shareLabel = el('span', 'collab-role-card__label', 'MODE 01');
  const shareIcon = el('span', 'collab-role-card__icon');
  shareIcon.appendChild(iconBroadcast());
  const shareTitle = el('span', 'collab-role-card__title', 'Share');
  const shareDesc = el('p', 'collab-role-card__desc',
    'Start sharing your IDE screen with others. Students, teachers, or collaborators can view your code, terminal, and execution in real-time.');
  const shareCta = el('span', 'collab-role-card__cta');
  shareCta.appendChild(document.createTextNode('Go Live'));
  shareCta.appendChild(iconArrowRight());

  shareCard.appendChild(shareLabel);
  shareCard.appendChild(shareIcon);
  shareCard.appendChild(shareTitle);
  shareCard.appendChild(shareDesc);
  shareCard.appendChild(shareCta);

  shareCard.addEventListener('click', () => onSelectRole('sharer'));

  // ── VIEW CARD ──
  const viewCard = el('button', 'collab-role-card');
  viewCard.id = 'collab-role-view';
  viewCard.setAttribute('data-role', 'viewer');

  const viewLabel = el('span', 'collab-role-card__label', 'MODE 02');
  const viewIcon = el('span', 'collab-role-card__icon');
  viewIcon.appendChild(iconEye());
  const viewTitle = el('span', 'collab-role-card__title', 'View');
  const viewDesc = el('p', 'collab-role-card__desc',
    'Connect to a sharer\'s IDE in read-only mode. See their code, terminal output, and errors in real-time. Perfect for teachers viewing student work.');
  const viewCta = el('span', 'collab-role-card__cta');
  viewCta.appendChild(document.createTextNode('Connect'));
  viewCta.appendChild(iconArrowRight());

  viewCard.appendChild(viewLabel);
  viewCard.appendChild(viewIcon);
  viewCard.appendChild(viewTitle);
  viewCard.appendChild(viewDesc);
  viewCard.appendChild(viewCta);

  viewCard.addEventListener('click', () => onSelectRole('viewer'));

  container.appendChild(shareCard);
  container.appendChild(viewCard);

  return container;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Share Panel — Go Live, Room Key, Viewers List
// ══════════════════════════════════════════════════════════════════

export function buildSharePanel(callbacks) {
  const panel = el('div', 'collab-share-panel');
  panel.id = 'collab-share-panel';

  const sectionTitle = el('div', 'collab-section-title', 'SHARING CONTROLS');
  panel.appendChild(sectionTitle);

  // Connection mode toggle (LAN / Cloud)
  const modeToggle = document.createElement('div');
  modeToggle.className = 'collab-mode-toggle';
  modeToggle.id = 'collab-share-mode-toggle';

  const lanBtn = document.createElement('button');
  lanBtn.className = 'collab-mode-toggle__btn active';
  lanBtn.id = 'collab-share-mode-lan';
  lanBtn.type = 'button';
  lanBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg> <span>LAN</span>`;

  const cloudBtn = document.createElement('button');
  cloudBtn.className = 'collab-mode-toggle__btn';
  cloudBtn.id = 'collab-share-mode-cloud';
  cloudBtn.type = 'button';
  cloudBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg> <span>Cloud</span>`;

  lanBtn.addEventListener('click', () => {
    lanBtn.classList.add('active');
    cloudBtn.classList.remove('active');
    relayGroup.classList.remove('visible');
    if (callbacks.onModeChange) callbacks.onModeChange('lan');
  });

  cloudBtn.addEventListener('click', () => {
    cloudBtn.classList.add('active');
    lanBtn.classList.remove('active');
    relayGroup.classList.add('visible');
    if (callbacks.onModeChange) callbacks.onModeChange('cloud');
  });

  modeToggle.appendChild(lanBtn);
  modeToggle.appendChild(cloudBtn);
  panel.appendChild(modeToggle);

  // Relay URL input (hidden by default, shown when Cloud mode)
  const relayGroup = document.createElement('div');
  relayGroup.className = 'collab-relay-group';
  relayGroup.id = 'collab-share-relay-group';

  const relayLabel = document.createElement('label');
  relayLabel.className = 'collab-relay-label';
  relayLabel.textContent = 'RELAY SERVER URL';
  relayLabel.setAttribute('for', 'collab-share-relay-url');

  const relayInput = document.createElement('input');
  relayInput.className = 'collab-relay-input';
  relayInput.id = 'collab-share-relay-url';
  relayInput.type = 'text';
  relayInput.placeholder = 'wss://your-relay.onrender.com';
  relayInput.spellcheck = false;
  relayInput.autocomplete = 'off';

  // Load saved URL
  try {
    const saved = localStorage.getItem('theta172_relay_url');
    if (saved) relayInput.value = saved;
  } catch (_) {}

  relayGroup.appendChild(relayLabel);
  relayGroup.appendChild(relayInput);
  panel.appendChild(relayGroup);

  // Password input (optional)
  const passwordGroup = el('div', 'collab-password-group');
  const passwordLabel = el('label', 'collab-password-label', 'ROOM PASSWORD (OPTIONAL)');
  passwordLabel.setAttribute('for', 'collab-share-password');

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'collab-password-input';
  passwordInput.id = 'collab-share-password';
  passwordInput.placeholder = 'Leave empty for open room';
  passwordInput.autocomplete = 'off';
  passwordInput.spellcheck = false;
  passwordInput.maxLength = 128;

  const passwordToggle = el('button', 'collab-password-toggle');
  passwordToggle.type = 'button';
  passwordToggle.title = 'Show password';
  passwordToggle.appendChild(iconEyeSmall());
  passwordToggle.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    passwordToggle.title = isHidden ? 'Hide password' : 'Show password';
  });

  const passwordWrapper = el('div', 'collab-password-wrapper');
  passwordWrapper.appendChild(passwordInput);
  passwordWrapper.appendChild(passwordToggle);

  passwordGroup.appendChild(passwordLabel);
  passwordGroup.appendChild(passwordWrapper);
  panel.appendChild(passwordGroup);

  // Go Live button
  const goLiveBtn = el('button', 'collab-go-live-btn');
  goLiveBtn.id = 'collab-go-live';
  const liveIcon = iconLive();
  goLiveBtn.appendChild(liveIcon);
  goLiveBtn.appendChild(document.createTextNode('Go Live'));
  goLiveBtn.addEventListener('click', callbacks.onGoLive);
  panel.appendChild(goLiveBtn);

  // Stop sharing button (hidden initially)
  const stopBtn = el('button', 'collab-stop-btn');
  stopBtn.id = 'collab-stop-share';
  stopBtn.style.display = 'none';
  stopBtn.appendChild(iconDisconnect());
  stopBtn.appendChild(document.createTextNode('Stop Sharing'));
  stopBtn.addEventListener('click', callbacks.onStopSharing);
  panel.appendChild(stopBtn);

  // Room key display (hidden initially)
  const roomKeyContainer = el('div', 'collab-room-key');
  roomKeyContainer.id = 'collab-room-key';
  roomKeyContainer.style.display = 'none';

  const roomKeyLeft = el('div');
  const roomKeyLabel = el('div', 'collab-room-key__label', 'YOUR ROOM KEY');
  const roomKeyCode = el('div', 'collab-room-key__code');
  roomKeyCode.id = 'collab-room-key-code';
  roomKeyCode.textContent = '---';

  const directConnectLabel = el('div', 'collab-room-key__label');
  directConnectLabel.style.marginTop = '12px';
  directConnectLabel.style.color = '#e06c75';
  directConnectLabel.textContent = '⚡ DIRECT CONNECT URL (share this!)';

  const directConnectCode = el('div', 'collab-room-key__direct', '');
  directConnectCode.id = 'collab-direct-connect-code';
  directConnectCode.style.fontSize = '13px';
  directConnectCode.style.color = '#e5c07b';
  directConnectCode.style.marginTop = '4px';
  directConnectCode.style.fontFamily = 'monospace';
  directConnectCode.style.padding = '6px 10px';
  directConnectCode.style.background = 'rgba(0,0,0,0.2)';
  directConnectCode.style.borderRadius = '6px';
  directConnectCode.style.cursor = 'pointer';
  directConnectCode.title = 'Click to copy';
  directConnectCode.addEventListener('click', () => {
    const text = directConnectCode.textContent;
    if (text && text !== '---') {
      navigator.clipboard.writeText(text).then(() => {
        directConnectCode.style.color = '#98c379';
        setTimeout(() => { directConnectCode.style.color = '#e5c07b'; }, 1000);
      });
    }
  });

  const directConnectHelp = el('div');
  directConnectHelp.style.fontSize = '10px';
  directConnectHelp.style.color = '#8E8E8C';
  directConnectHelp.style.marginTop = '4px';
  directConnectHelp.textContent = 'Students paste this in the Connect box if Room Key doesn\'t work';

  roomKeyLeft.appendChild(roomKeyLabel);
  roomKeyLeft.appendChild(roomKeyCode);
  roomKeyLeft.appendChild(directConnectLabel);
  roomKeyLeft.appendChild(directConnectCode);
  roomKeyLeft.appendChild(directConnectHelp);

  const copyBtn = el('button', 'collab-room-key__copy');
  copyBtn.id = 'collab-copy-key';
  copyBtn.appendChild(iconCopy());
  copyBtn.appendChild(document.createTextNode('Copy'));
  copyBtn.addEventListener('click', callbacks.onCopyKey);

  roomKeyContainer.appendChild(roomKeyLeft);
  roomKeyContainer.appendChild(copyBtn);
  panel.appendChild(roomKeyContainer);

  // Viewers section (hidden initially)
  const viewersSection = el('div', 'collab-viewers');
  viewersSection.id = 'collab-viewers-section';
  viewersSection.style.display = 'none';

  const viewersDot = el('span', 'collab-viewers__dot');
  const viewersCount = el('span', 'collab-viewers__count');
  viewersCount.id = 'collab-viewers-count';
  viewersCount.textContent = '0 viewers connected';

  viewersSection.appendChild(viewersDot);
  viewersSection.appendChild(viewersCount);

  const viewersList = el('div', 'collab-viewers__list');
  viewersList.id = 'collab-viewers-list';
  viewersSection.appendChild(viewersList);

  panel.appendChild(viewersSection);

  // Collaborative editing toggle button (hidden until sharing)
  const collabToggle = document.createElement('button');
  collabToggle.className = 'collab-toggle-btn';
  collabToggle.id = 'collab-toggle-editing';
  collabToggle.style.display = 'none';

  const toggleIcon = document.createElement('span');
  toggleIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`;

  const toggleLabel = document.createElement('span');
  toggleLabel.className = 'collab-toggle-btn__label';
  toggleLabel.textContent = 'Collaborative Editing';

  const toggleStatus = document.createElement('span');
  toggleStatus.className = 'collab-toggle-btn__status';
  toggleStatus.textContent = 'OFF';

  collabToggle.appendChild(toggleIcon);
  collabToggle.appendChild(toggleLabel);
  collabToggle.appendChild(toggleStatus);

  if (callbacks.onToggleCollab) {
    collabToggle.addEventListener('click', callbacks.onToggleCollab);
  }

  panel.appendChild(collabToggle);

  return panel;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Viewer Panel — Connect Input, Nearby Devices
// ══════════════════════════════════════════════════════════════════

export function buildViewerPanel(callbacks) {
  const panel = el('div', 'collab-viewer-panel');
  panel.id = 'collab-viewer-panel';

  const sectionTitle = el('div', 'collab-section-title', 'CONNECT TO A SHARER');
  panel.appendChild(sectionTitle);

  // Connection mode toggle (LAN / Cloud)
  const vModeToggle = document.createElement('div');
  vModeToggle.className = 'collab-mode-toggle';
  vModeToggle.id = 'collab-viewer-mode-toggle';

  const vLanBtn = document.createElement('button');
  vLanBtn.className = 'collab-mode-toggle__btn active';
  vLanBtn.id = 'collab-viewer-mode-lan';
  vLanBtn.type = 'button';
  vLanBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg> <span>LAN</span>`;

  const vCloudBtn = document.createElement('button');
  vCloudBtn.className = 'collab-mode-toggle__btn';
  vCloudBtn.id = 'collab-viewer-mode-cloud';
  vCloudBtn.type = 'button';
  vCloudBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg> <span>Cloud</span>`;

  vLanBtn.addEventListener('click', () => {
    vLanBtn.classList.add('active');
    vCloudBtn.classList.remove('active');
    vRelayGroup.classList.remove('visible');
    // Show nearby devices in LAN mode
    const nearbyEl = document.getElementById('collab-nearby');
    if (nearbyEl) nearbyEl.style.display = '';
    if (callbacks.onViewerModeChange) callbacks.onViewerModeChange('lan');
  });

  vCloudBtn.addEventListener('click', () => {
    vCloudBtn.classList.add('active');
    vLanBtn.classList.remove('active');
    vRelayGroup.classList.add('visible');
    // Hide nearby devices in Cloud mode
    const nearbyEl = document.getElementById('collab-nearby');
    if (nearbyEl) nearbyEl.style.display = 'none';
    if (callbacks.onViewerModeChange) callbacks.onViewerModeChange('cloud');
  });

  vModeToggle.appendChild(vLanBtn);
  vModeToggle.appendChild(vCloudBtn);
  panel.appendChild(vModeToggle);

  // Relay URL input (viewer side, hidden by default)
  const vRelayGroup = document.createElement('div');
  vRelayGroup.className = 'collab-relay-group';
  vRelayGroup.id = 'collab-viewer-relay-group';

  const vRelayLabel = document.createElement('label');
  vRelayLabel.className = 'collab-relay-label';
  vRelayLabel.textContent = 'RELAY SERVER URL';
  vRelayLabel.setAttribute('for', 'collab-viewer-relay-url');

  const vRelayInput = document.createElement('input');
  vRelayInput.className = 'collab-relay-input';
  vRelayInput.id = 'collab-viewer-relay-url';
  vRelayInput.type = 'text';
  vRelayInput.placeholder = 'wss://your-relay.onrender.com';
  vRelayInput.spellcheck = false;
  vRelayInput.autocomplete = 'off';

  try {
    const saved = localStorage.getItem('theta172_relay_url');
    if (saved) vRelayInput.value = saved;
  } catch (_) {}

  vRelayGroup.appendChild(vRelayLabel);
  vRelayGroup.appendChild(vRelayInput);
  panel.appendChild(vRelayGroup);

  // Connection key input
  const form = el('div', 'collab-connect-form');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'collab-connect-input';
  input.id = 'collab-connect-input';
  input.placeholder = 'T72-XXX or IP:PORT/T72-XXX';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 40;

  // Auto-format room key as user types: t72abc -> T72-ABC
  // Skip formatting if user is pasting a Direct Connect URL (contains dots/colons)
  input.addEventListener('input', () => {
    const rawValue = input.value;
    
    // If it looks like a Direct Connect URL, don't auto-format
    if (rawValue.includes('.') || rawValue.includes(':') || rawValue.includes('/')) {
      return;
    }

    let raw = rawValue.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // If they typed 4+ chars starting with T72, insert the dash
    if (raw.length >= 4 && raw.startsWith('T72')) {
      raw = 'T72-' + raw.slice(3);
    } else if (raw.length === 3 && raw === 'T72') {
      raw = 'T72-';
    }

    // Clamp to T72-XXX (7 chars) for room keys only
    if (raw.length > 7) raw = raw.slice(0, 7);

    // Only update if different (preserves cursor position)
    if (input.value !== raw) {
      const cursorPos = input.selectionStart;
      const lengthDiff = raw.length - input.value.length;
      input.value = raw;
      const newPos = Math.max(0, cursorPos + lengthDiff);
      input.setSelectionRange(newPos, newPos);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      callbacks.onConnect(input.value.trim());
    }
  });

  const connectBtn = el('button', 'collab-connect-btn');
  connectBtn.id = 'collab-connect-btn';
  connectBtn.appendChild(iconConnect());
  connectBtn.appendChild(document.createTextNode('Connect'));
  connectBtn.addEventListener('click', () => {
    callbacks.onConnect(input.value.trim());
  });

  form.appendChild(input);
  form.appendChild(connectBtn);
  panel.appendChild(form);

  // Password input (if room is password-protected)
  const passwordGroup = el('div', 'collab-password-group');
  const passwordLabel = el('label', 'collab-password-label', 'ROOM PASSWORD');
  passwordLabel.setAttribute('for', 'collab-connect-password');

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'collab-password-input';
  passwordInput.id = 'collab-connect-password';
  passwordInput.placeholder = 'Enter if required...';
  passwordInput.autocomplete = 'off';
  passwordInput.spellcheck = false;
  passwordInput.maxLength = 128;

  const passwordToggle = el('button', 'collab-password-toggle');
  passwordToggle.type = 'button';
  passwordToggle.title = 'Show password';
  passwordToggle.appendChild(iconEyeSmall());
  passwordToggle.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    passwordToggle.title = isHidden ? 'Hide password' : 'Show password';
  });

  const passwordWrapper = el('div', 'collab-password-wrapper');
  passwordWrapper.appendChild(passwordInput);
  passwordWrapper.appendChild(passwordToggle);

  passwordGroup.appendChild(passwordLabel);
  passwordGroup.appendChild(passwordWrapper);
  panel.appendChild(passwordGroup);

  // Nearby devices section
  const nearby = el('div', 'collab-nearby');
  nearby.id = 'collab-nearby';

  const nearbyTitle = el('div', 'collab-nearby__title');
  nearbyTitle.appendChild(document.createTextNode('NEARBY DEVICES'));
  const scanningDot = el('span', 'collab-nearby__scanning');
  scanningDot.id = 'collab-scanning-indicator';
  nearbyTitle.appendChild(scanningDot);

  nearby.appendChild(nearbyTitle);

  const nearbyList = el('div', 'collab-nearby__list');
  nearbyList.id = 'collab-nearby-list';

  const emptyMsg = el('div', 'collab-nearby__empty',
    'Scanning for nearby THETA172 instances...');
  emptyMsg.id = 'collab-nearby-empty';
  nearbyList.appendChild(emptyMsg);

  nearby.appendChild(nearbyList);
  panel.appendChild(nearby);

  // Connected status (hidden initially)
  const connectedStatus = el('div', 'collab-connected-status');
  connectedStatus.id = 'collab-connected-status';

  const statusHeader = el('div', 'collab-connected-status__header');

  const statusLeft = el('div');
  const statusTitle = el('div', 'collab-connected-status__title', 'Connected');
  const statusHost = el('div', 'collab-connected-status__host');
  statusHost.id = 'collab-connected-host';
  statusHost.textContent = 'Viewing: ---';
  statusLeft.appendChild(statusTitle);
  statusLeft.appendChild(statusHost);

  const statusRight = el('div');
  const statusIndicator = el('span', 'collab-connected-status__indicator', 'Live');
  statusRight.appendChild(statusIndicator);

  statusHeader.appendChild(statusLeft);
  statusHeader.appendChild(statusRight);
  connectedStatus.appendChild(statusHeader);

  const disconnectBtn = el('button', 'collab-disconnect-btn');
  disconnectBtn.id = 'collab-disconnect-btn';
  disconnectBtn.appendChild(iconDisconnect());
  disconnectBtn.appendChild(document.createTextNode('Disconnect'));
  disconnectBtn.addEventListener('click', callbacks.onDisconnect);
  connectedStatus.appendChild(disconnectBtn);

  panel.appendChild(connectedStatus);

  return panel;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: How It Works — Editorial Steps
// ══════════════════════════════════════════════════════════════════

export function buildHowItWorks() {
  const section = el('div', 'collab-how');

  const title = el('div', 'collab-how__title', 'HOW IT WORKS');
  section.appendChild(title);

  const steps = el('div', 'collab-how__steps');

  const stepsData = [
    { num: '01', text: 'Click "Go Live" to start sharing your IDE. Your editor, terminal, and execution state are broadcast in real-time.' },
    { num: '02', text: 'Share your room key with others, or let nearby THETA172 users discover you automatically on the same network.' },
    { num: '03', text: 'Viewers connect and see your full IDE in read-only mode. They see exactly what you see — code, output, errors.' },
    { num: '04', text: 'Teachers can view all students from a dashboard grid. Click any student to see their full IDE and identify issues instantly.' },
  ];

  stepsData.forEach((data) => {
    const step = el('div', 'collab-how__step');
    const num = el('div', 'collab-how__step-number', data.num);
    const text = el('div', 'collab-how__step-text', data.text);
    step.appendChild(num);
    step.appendChild(text);
    steps.appendChild(step);
  });

  section.appendChild(steps);

  return section;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Footer
// ══════════════════════════════════════════════════════════════════

export function buildFooter() {
  const footer = el('div', 'collab-footer');

  const left = el('div', 'collab-footer__left', 'THETA172 · COLLABORATIVE CODING');
  const right = el('div', 'collab-footer__right', 'Peer-to-peer · Encrypted · Zero config');

  footer.appendChild(left);
  footer.appendChild(right);

  return footer;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Device Card (for nearby list)
// ══════════════════════════════════════════════════════════════════

export function buildDeviceCard(device, onConnect) {
  const card = el('div', 'collab-device-card');
  card.setAttribute('data-device-id', device.id);

  const info = el('div', 'collab-device-card__info');
  const name = el('div', 'collab-device-card__name', device.name);
  const meta = el('div', 'collab-device-card__meta', device.meta || 'Local Network');
  info.appendChild(name);
  info.appendChild(meta);

  const connectBtn = el('button', 'collab-device-card__connect', 'Connect');
  connectBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onConnect(device);
  });

  card.appendChild(info);
  card.appendChild(connectBtn);

  card.addEventListener('click', () => onConnect(device));

  return card;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Viewer Chip (for viewers list in share mode)
// ══════════════════════════════════════════════════════════════════

export function buildViewerChip(viewer) {
  const chip = el('span', 'collab-viewer-chip');
  chip.setAttribute('data-viewer-id', viewer.id);

  const signal = iconSignal();
  signal.style.width = '10px';
  signal.style.height = '10px';
  chip.appendChild(signal);
  chip.appendChild(document.createTextNode(viewer.name));

  return chip;
}


// ══════════════════════════════════════════════════════════════════
// BUILD: Dashboard Tile (for classroom grid — Phase 5 skeleton)
// ══════════════════════════════════════════════════════════════════

export function buildDashboardTile(student, onClick) {
  const tile = el('div', 'collab-dashboard__tile');
  if (student.hasError) tile.classList.add('collab-dashboard__tile--error');
  tile.setAttribute('data-student-id', student.id);

  const header = el('div', 'collab-dashboard__tile-header');
  const name = el('span', 'collab-dashboard__tile-name', student.name);
  const status = el('span', `collab-dashboard__tile-status collab-dashboard__tile-status--${student.status}`,
    student.status.toUpperCase());
  header.appendChild(name);
  header.appendChild(status);

  const preview = el('div', 'collab-dashboard__tile-preview');
  preview.textContent = student.codePreview || '# No code yet';

  tile.appendChild(header);
  tile.appendChild(preview);

  tile.addEventListener('click', () => onClick(student));

  return tile;
}

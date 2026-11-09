/**
 * THETA172 — Toast notifications (CSS animations, see base.css)
 */

const TYPES = {
  success: { color: '#7BD88F', icon: `<path d="M3 7.5L6 10.5L11 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` },
  error:   { color: '#FF4A36', icon: `<path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` },
  info:    { color: '#C4C4C4', icon: `<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M7 5V5.5M7 7V9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` },
  save:    { color: '#7BD88F', icon: `<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` },
};

let container = null;

function ensureContainer() {
  if (container) return;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
}

/**
 * Build the toast DOM. The icon markup is a fixed constant from TYPES;
 * the message is ALWAYS inserted as text, because toasts show names and
 * text that arrive over the classroom network (untrusted input).
 */
export function buildToastElement(message, cfg = TYPES.info) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'toast-icon');
  icon.setAttribute('width', '14');
  icon.setAttribute('height', '14');
  icon.setAttribute('viewBox', '0 0 14 14');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('aria-hidden', 'true');
  icon.style.color = cfg.color;
  icon.innerHTML = cfg.icon; // trusted constant

  const text = document.createElement('span');
  text.textContent = String(message ?? '');

  const progress = document.createElement('div');
  progress.className = 'toast-progress';
  progress.style.background = cfg.color;

  el.append(icon, text, progress);
  return el;
}

export function showToast(message, type = 'info', duration = 3000) {
  ensureContainer();
  const cfg = TYPES[type] || TYPES.info;

  const el = buildToastElement(message, cfg);
  const prog = el.querySelector('.toast-progress');
  if (prog) prog.style.animationDuration = `${duration}ms`;
  container.appendChild(el);

  // Keep at most four on screen
  while (container.children.length > 4) container.firstElementChild.remove();

  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // in case animations are off
  }, duration);
}

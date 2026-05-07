/**
 * THETA172 — Toast Notification System (GSAP-powered)
 */

import gsap from 'gsap';

const TYPES = {
  success: { color: '#28C840', icon: `<path d="M3 7.5L6 10.5L11 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` },
  error:   { color: '#FF5A3C', icon: `<path d="M3 3L11 11M11 3L3 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` },
  info:    { color: '#5C8AFF', icon: `<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.3"/><path d="M7 5V5.5M7 7V9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>` },
  save:    { color: '#28C840', icon: `<path d="M2 3H9L12 6V13H2V3Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` },
};

let container = null;

function ensureContainer() {
  if (container) return;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
}

export function showToast(message, type = 'info', duration = 3000) {
  ensureContainer();
  const cfg = TYPES[type] || TYPES.info;

  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <svg class="toast-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" style="color:${cfg.color}">${cfg.icon}</svg>
    <span>${message}</span>
    <div class="toast-progress" style="background:${cfg.color}"></div>
  `;
  container.appendChild(el);

  // GSAP entrance
  gsap.fromTo(el,
    { opacity: 0, x: 30, scale: 0.95 },
    { opacity: 1, x: 0, scale: 1, duration: 0.35, ease: 'power3.out' }
  );

  // Progress bar countdown
  const prog = el.querySelector('.toast-progress');
  gsap.fromTo(prog,
    { scaleX: 1 },
    { scaleX: 0, duration: duration / 1000, ease: 'none' }
  );

  // GSAP exit
  setTimeout(() => {
    gsap.to(el, {
      opacity: 0, x: 20, scale: 0.95,
      duration: 0.28, ease: 'power2.in',
      onComplete: () => el.remove(),
    });
  }, duration);
}

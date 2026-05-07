/**
 * THETA172 — Ripple Effect (GSAP-powered)
 */

import gsap from 'gsap';

export function addRipple(el) {
  el.style.position = 'relative';
  el.style.overflow = 'hidden';

  el.addEventListener('click', (e) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 2.5;

    const ripple = document.createElement('span');
    ripple.className = 'ripple-wave';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x - size / 2 + 'px';
    ripple.style.top = y - size / 2 + 'px';
    el.appendChild(ripple);

    gsap.fromTo(ripple,
      { scale: 0, opacity: 0.4 },
      { scale: 1, opacity: 0, duration: 0.5, ease: 'power2.out', onComplete: () => ripple.remove() }
    );
  });
}

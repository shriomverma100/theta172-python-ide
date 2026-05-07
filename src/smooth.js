/**
 * THETA172 — Ultra-Smooth Interaction Engine
 * 
 * GPU-accelerated, spring-physics micro-interactions.
 * Makes every hover, click, scroll, and keystroke feel like 120fps butter.
 */

import gsap from 'gsap';

// ── CONFIG ──────────────────────────────────────────────────
const SPRING = { duration: 0.4, ease: 'elastic.out(1, 0.5)' };
const SNAP   = { duration: 0.15, ease: 'power3.out' };
const SILK   = { duration: 0.25, ease: 'power2.out' };

// ── 1. GPU LAYER PROMOTION ─────────────────────────────────
// Force every interactive element onto its own compositor layer
export function promoteToGPU() {
  const style = document.createElement('style');
  style.textContent = `
    button, a, [role="button"], .topbar-btn, .btn-run,
    .topbar-logo-btn, .wc-btn, .pane-action-btn, .topbar-file,
    .run-status, .status-item, .toast, .modal-content,
    .ide-gutter, .shortcut-item, .shortcut-keys, kbd,
    .pip-bar__btn, .cmd-result-item {
      will-change: transform, opacity;
      transform: translateZ(0);
      -webkit-font-smoothing: subpixel-antialiased;
    }
    
    /* Buttery smooth scrolling everywhere */
    *, *::before, *::after {
      scroll-behavior: smooth;
    }
    
    /* Eliminate jank on resize/layout */
    .ide-pane, .monaco-container, .terminal-container {
      contain: layout style paint;
    }
    
    /* High-performance rendering */
    .ide {
      -webkit-backface-visibility: hidden;
      backface-visibility: hidden;
      perspective: 1000px;
    }
  `;
  document.head.appendChild(style);
}

// ── 2. SPRING-PHYSICS BUTTON PRESS ─────────────────────────
// Every button gets a juicy spring bounce on click
export function springButtons() {
  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button, [role="button"], .topbar-btn, .btn-run, .wc-btn, .pane-action-btn, .pip-bar__btn');
    if (!btn) return;

    gsap.killTweensOf(btn);
    gsap.to(btn, {
      scale: 0.94,
      ...SNAP,
    });
  }, { passive: true });

  document.addEventListener('mouseup', (e) => {
    const btn = e.target.closest('button, [role="button"], .topbar-btn, .btn-run, .wc-btn, .pane-action-btn, .pip-bar__btn');
    if (!btn) return;

    gsap.killTweensOf(btn);
    gsap.to(btn, {
      scale: 1,
      ...SPRING,
    });
  }, { passive: true });

  // Safety: if mouse leaves while pressed, snap back
  document.addEventListener('mouseleave', (e) => {
    if (!e.target?.closest) return;
    const btn = e.target.closest('button, [role="button"], .topbar-btn, .btn-run, .wc-btn, .pane-action-btn');
    if (!btn) return;
    gsap.to(btn, { scale: 1, ...SILK });
  }, { passive: true, capture: true });
}

// ── 3. MAGNETIC HOVER ──────────────────────────────────────
// Buttons subtly pull toward the cursor on hover
export function magneticHover() {
  const PULL = 0.15; // How much to pull (fraction of button size)

  document.querySelectorAll('.topbar-btn, .btn-run, .topbar-logo-btn, .wc-btn').forEach(btn => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) * PULL;
      const dy = (e.clientY - cy) * PULL;

      gsap.to(btn, {
        x: dx,
        y: dy,
        duration: 0.3,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    }, { passive: true });

    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, {
        x: 0,
        y: 0,
        ...SPRING,
        overwrite: 'auto',
      });
    }, { passive: true });
  });
}

// ── 4. CURSOR GLOW ─────────────────────────────────────────
// Subtle radial glow follows cursor across the topbar
export function cursorGlow() {
  const topbar = document.querySelector('.ide-topbar');
  if (!topbar) return;

  // Create glow element
  const glow = document.createElement('div');
  glow.style.cssText = `
    position: absolute;
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,51,0,0.06) 0%, transparent 70%);
    pointer-events: none;
    transform: translate(-50%, -50%);
    z-index: 0;
    opacity: 0;
    transition: opacity 300ms ease;
  `;
  topbar.style.position = 'relative';
  topbar.appendChild(glow);

  topbar.addEventListener('mousemove', (e) => {
    const rect = topbar.getBoundingClientRect();
    gsap.to(glow, {
      left: e.clientX - rect.left,
      top: e.clientY - rect.top,
      opacity: 1,
      duration: 0.15,
      ease: 'power1.out',
      overwrite: true,
    });
  }, { passive: true });

  topbar.addEventListener('mouseleave', () => {
    gsap.to(glow, { opacity: 0, duration: 0.4, ease: 'power2.out' });
  }, { passive: true });
}

// ── 5. SMOOTH GUTTER DRAG ──────────────────────────────────
// Makes the pane gutter feel silky when dragging
export function smoothGutter() {
  const gutter = document.querySelector('.ide-gutter');
  if (!gutter) return;

  gutter.addEventListener('mouseenter', () => {
    gsap.to(gutter, { scaleX: 1.8, duration: 0.2, ease: 'power2.out' });
  }, { passive: true });

  gutter.addEventListener('mouseleave', () => {
    gsap.to(gutter, { scaleX: 1, ...SPRING });
  }, { passive: true });
}

// ── 6. KEYSTROKE PULSE ─────────────────────────────────────
// Subtle border pulse on the editor when typing
export function keystrokePulse() {
  const editorPane = document.querySelector('.ide-pane--editor');
  if (!editorPane) return;

  let pulseTimeout;
  document.addEventListener('keydown', (e) => {
    // Only for printable characters while editor is focused
    const active = document.activeElement;
    const isEditorFocused = active?.closest('.monaco-container') ||
                            active?.closest('.monaco-editor');
    if (!isEditorFocused) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    clearTimeout(pulseTimeout);

    gsap.to(editorPane, {
      borderRightColor: 'rgba(255, 51, 0, 0.25)',
      duration: 0.08,
      ease: 'power1.out',
      overwrite: true,
    });

    pulseTimeout = setTimeout(() => {
      gsap.to(editorPane, {
        borderRightColor: 'transparent',
        duration: 0.5,
        ease: 'power2.out',
      });
    }, 80);
  }, { passive: true });
}

// ── 7. SMOOTH SCROLL MOMENTUM ──────────────────────────────
// Enhanced scroll inertia for all scrollable containers
export function smoothScroll() {
  document.querySelectorAll('.shortcuts-list, .cmd-results, .examples-list, .modal-content').forEach(el => {
    el.style.scrollBehavior = 'smooth';
    el.style.overscrollBehavior = 'contain';
    el.style.webkitOverflowScrolling = 'touch';
  });
}

// ── 8. TOAST SPRING ENTRANCE ───────────────────────────────
// Override toast animations with spring physics
export function smoothToasts() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.classList?.contains('toast')) {
          gsap.killTweensOf(node);
          gsap.fromTo(node,
            { x: 40, opacity: 0, scale: 0.92 },
            { x: 0, opacity: 1, scale: 1, ...SPRING }
          );
        }
      }
    }
  });

  const container = document.querySelector('.toast-container');
  if (container) {
    observer.observe(container, { childList: true });
  }
}

// ── 9. SMOOTH STATUS DOT ───────────────────────────────────
// The run status dot gets a smooth morphing animation
export function smoothStatusDot() {
  const dot = document.querySelector('.run-status__dot');
  if (!dot) return;

  const observer = new MutationObserver(() => {
    gsap.fromTo(dot,
      { scale: 0.4 },
      { scale: 1, ...SPRING }
    );
  });

  const status = dot.closest('.run-status');
  if (status) {
    observer.observe(status, { attributes: true, attributeFilter: ['class'] });
  }
}

// ── 10. CLICK RIPPLE V2 (ink spread) ───────────────────────
// Ultra-smooth GSAP ripple on every interactive element
export function inkRipple() {
  document.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('button, .topbar-btn, .btn-run, .topbar-logo-btn, .shortcut-item, .cmd-result-item, .example-item');
    if (!target) return;

    // Ensure positioning context
    const pos = getComputedStyle(target).position;
    if (pos === 'static') target.style.position = 'relative';
    target.style.overflow = 'hidden';

    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 2.5;

    const ink = document.createElement('span');
    ink.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x - size / 2}px;
      top: ${y - size / 2}px;
      border-radius: 50%;
      background: rgba(17, 17, 17, 0.08);
      pointer-events: none;
      z-index: 10;
    `;
    target.appendChild(ink);

    gsap.fromTo(ink,
      { scale: 0, opacity: 0.5 },
      {
        scale: 1,
        opacity: 0,
        duration: 0.55,
        ease: 'power2.out',
        onComplete: () => ink.remove(),
      }
    );
  }, { passive: true });
}

// ── 11. SMOOTH WINDOW TRANSITION ───────────────────────────
// Landing → IDE transition with spring physics
export function smoothPageTransition(fromEl, toEl) {
  return new Promise((resolve) => {
    const tl = gsap.timeline({
      onComplete: resolve,
      defaults: { ease: 'power3.inOut' },
    });

    tl.to(fromEl, {
      opacity: 0,
      scale: 0.98,
      y: -12,
      duration: 0.3,
    })
    .set(fromEl, { display: 'none' })
    .set(toEl, { display: 'flex', opacity: 0, scale: 0.995, y: 8 })
    .to(toEl, {
      opacity: 1,
      scale: 1,
      y: 0,
      duration: 0.4,
      ease: 'power2.out',
    });
  });
}

// ── MASTER INIT ────────────────────────────────────────────
export function initSmoothEngine() {
  promoteToGPU();
  springButtons();
  inkRipple();
  smoothScroll();
  smoothToasts();
  smoothStatusDot();

  // Defer heavy stuff to after first paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      magneticHover();
      cursorGlow();
      smoothGutter();
      keystrokePulse();
    });
  });

  console.log('[THETA] ✦ Smooth Engine initialized');
}

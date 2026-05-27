/**
 * THETA172 — Landing  (Artist Edition v2)
 * ─────────────────────────────────────────────────────────────────
 *  · Canvas code-stream background
 *  · Kinetic word-morph title (CODE FAST / BUILD SHARP / SHIP NOW)
 *  · GSAP staggered entrance with spring physics
 *  · 3D tilt on stat cards & code preview
 *  · Animated counter stats
 *  · Particles
 *  · Typewriter code preview
 *  · 120fps GPU-accelerated smoothness
 */

import gsap from 'gsap';

// ── Word Morph Data ──────────────────────────────────────────────
const MORPH_WORDS = [
  { left: 'CODE',  right: 'FAST.'  },
  { left: 'BUILD', right: 'SHARP.' },
  { left: 'SHIP',  right: 'NOW.'   },
  { left: 'RUN',   right: 'FREE.'  },
];
let morphIndex = 0;
let isMorphing = false;

// ── Landing Spring Button Press (120fps) ─────────────────────────
function initLandingSmoothness() {
  const SPRING = { duration: 0.4, ease: 'elastic.out(1, 0.5)' };
  const SNAP   = { duration: 0.12, ease: 'power3.out' };

  // Spring-physics button press on the landing page
  const landing = document.getElementById('landing');
  if (!landing) return;

  landing.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button, [role="button"]');
    if (!btn) return;
    gsap.killTweensOf(btn);
    gsap.to(btn, { scale: 0.93, ...SNAP });
  }, { passive: true });

  landing.addEventListener('mouseup', (e) => {
    const btn = e.target.closest('button, [role="button"]');
    if (!btn) return;
    gsap.killTweensOf(btn);
    gsap.to(btn, { scale: 1, ...SPRING });
  }, { passive: true });

  // Ink ripple on CTA button
  const cta = landing.querySelector('.btn-launch-main');
  if (cta) {
    cta.addEventListener('pointerdown', (e) => {
      const rect = cta.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const size = Math.max(rect.width, rect.height) * 2.5;

      const ink = document.createElement('span');
      ink.style.cssText = `
        position: absolute; width: ${size}px; height: ${size}px;
        left: ${x - size / 2}px; top: ${y - size / 2}px;
        border-radius: 50%; background: rgba(255,255,255,0.12);
        pointer-events: none; z-index: 10;
      `;
      cta.appendChild(ink);
      gsap.fromTo(ink,
        { scale: 0, opacity: 0.6 },
        { scale: 1, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => ink.remove() }
      );
    }, { passive: true });
  }
}

// ── Canvas Code Stream ───────────────────────────────────────────
function initCodeStream() {
  const canvas = document.getElementById('code-stream-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W, H, cols, drops;
  const CHARS = '01λ{}[]()=>+*def:return for if import class print range while True False None and or not in is';

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    const fontSize = 13;
    cols = Math.floor(W / fontSize);
    drops = new Array(cols).fill(0).map(() => Math.random() * H);
  }

  resize();
  window.addEventListener('resize', resize);

  const charArray = CHARS.split(' ').join('').split('');

  let frame = 0;
  function draw() {
    frame++;
    // Semi-transparent clear for trail
    ctx.fillStyle = 'rgba(234, 234, 232, 0.045)';
    ctx.fillRect(0, 0, W, H);

    ctx.font = '13px "JetBrains Mono", monospace';

    for (let i = 0; i < drops.length; i++) {
      const ch = charArray[Math.floor(Math.random() * charArray.length)];
      const x  = i * 13;
      const y  = drops[i] * 1;

      // First char is brighter (head)
      if (Math.floor(drops[i]) === Math.floor(drops[i])) {
        ctx.fillStyle = 'rgba(255, 45, 0, 0.7)';
      } else {
        ctx.fillStyle = 'rgba(13, 13, 13, 0.5)';
      }

      ctx.fillText(ch, x, y);

      // Reset drop when it reaches bottom
      if (y > H && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 14;
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ── Particles ─────────────────────────────────────────────────────
export function createParticles($container) {
  if (!$container) return;
  const count = 18;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'landing-particle';

    const size = 1.5 + Math.random() * 3.5;
    p.style.cssText = `
      left:   ${Math.random() * 100}%;
      top:    ${Math.random() * 100}%;
      width:  ${size}px;
      height: ${size}px;
    `;
    p.style.setProperty('--dur',   (5 + Math.random() * 8) + 's');
    p.style.setProperty('--delay', (Math.random() * 5) + 's');
    p.style.setProperty('--dx',    (Math.random() * 60 - 30) + 'px');
    p.style.setProperty('--dy',    (Math.random() * 40 - 20) + 'px');
    p.style.setProperty('--opa',   (0.05 + Math.random() * 0.18).toFixed(2));

    $container.appendChild(p);
  }
}

// ── 3D Tilt on Cards ─────────────────────────────────────────────
function initTiltCards() {
  const cards = document.querySelectorAll('.landing-stat-card, #landing-code-preview, #landing-accent-block');

  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r    = card.getBoundingClientRect();
      const cx   = r.left + r.width  / 2;
      const cy   = r.top  + r.height / 2;
      const dx   = (e.clientX - cx) / (r.width  / 2);
      const dy   = (e.clientY - cy) / (r.height / 2);
      const tiltX = dy * -6;
      const tiltY = dx *  6;

      gsap.to(card, {
        rotateX: tiltX,
        rotateY: tiltY,
        transformPerspective: 800,
        duration: 0.4,
        ease: 'power2.out',
      });
    });

    card.addEventListener('mouseleave', () => {
      gsap.to(card, {
        rotateX: 0,
        rotateY: 0,
        duration: 0.6,
        ease: 'elastic.out(1, 0.5)',
      });
    });
  });
}

// ── Animated Counter Stats ───────────────────────────────────────
function animateCounters() {
  // Left panel meta stats
  document.querySelectorAll('.meta-item__value[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    let current = 0;
    const step  = Math.max(1, Math.ceil(target / 40));
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current + suffix;
      if (current >= target) clearInterval(timer);
    }, 30);
  });

  // Right panel stat cards
  document.querySelectorAll('.stat-val[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target, 10);
    let current = 0;
    const step = Math.max(1, Math.ceil(target / 35));
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      el.textContent = current;
      if (current >= target) clearInterval(timer);
    }, 35);
  });

  // Animate progress bars
  setTimeout(() => {
    document.querySelectorAll('.stat-card__bar-fill').forEach(bar => {
      const w = bar.dataset.width || '60';
      bar.style.width = w + '%';
    });
  }, 400);
}

// ── Kinetic Word Morph ───────────────────────────────────────────
function startWordMorph() {
  const leftEl  = document.getElementById('title-word-left');
  const morphEl = document.getElementById('title-word-morph');
  if (!leftEl || !morphEl) return;

  function morphTo(nextIndex) {
    if (isMorphing) return;
    isMorphing = true;

    const next = MORPH_WORDS[nextIndex];

    const tl = gsap.timeline({
      onComplete: () => {
        isMorphing = false;
        morphIndex = nextIndex;
      }
    });

    // Scramble out
    tl.to([leftEl, morphEl], {
      y: -20,
      opacity: 0,
      duration: 0.4,
      ease: 'power3.in',
      stagger: 0.05,
    });

    // Swap text mid-air
    tl.call(() => {
      leftEl.textContent  = next.left;
      morphEl.textContent = next.right;
      morphEl.dataset.text = next.right;
    });

    // Slam in
    tl.fromTo([leftEl, morphEl],
      { y: 28, opacity: 0 },
      { y: 0,  opacity: 1, duration: 0.5, ease: 'power3.out', stagger: 0.06 }
    );
  }

  // Cycle every 3.2s
  setInterval(() => {
    const nextIndex = (morphIndex + 1) % MORPH_WORDS.length;
    morphTo(nextIndex);
  }, 3200);
}

// ── GSAP Landing Entrance ────────────────────────────────────────
export function animateLandingEntrance() {
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  // Nav
  tl.fromTo('.landing-nav',
    { opacity: 0, y: -24 },
    { opacity: 1, y: 0, duration: 0.55 }
  );

  // Badge
  tl.fromTo('.landing-hero__label',
    { opacity: 0, x: -20 },
    { opacity: 1, x: 0, duration: 0.45 },
    '-=0.2'
  );

  // Giant title
  tl.fromTo('.landing-hero__title',
    { opacity: 0, y: 30, skewY: 2 },
    { opacity: 1, y: 0, skewY: 0, duration: 0.75, ease: 'power4.out' },
    '-=0.15'
  );

  // Sub
  tl.fromTo('.landing-hero__sub',
    { opacity: 0, y: 16 },
    { opacity: 1, y: 0, duration: 0.45 },
    '-=0.35'
  );

  // CTA button
  tl.fromTo('.btn-launch-main',
    { opacity: 0, y: 16, scale: 0.95 },
    { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)' },
    '-=0.25'
  );

  // Meta stats
  tl.fromTo('.landing-hero__meta',
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4,
      onComplete: animateCounters,
    },
    '-=0.2'
  );

  // Right panel: accent block
  tl.fromTo('#landing-accent-block',
    { opacity: 0, x: 50, skewX: -3 },
    { opacity: 1, x: 0, skewX: 0, duration: 0.6, ease: 'expo.out' },
    '-=0.5'
  );

  // Stat cards staggered
  tl.fromTo('.landing-stat-card',
    { opacity: 0, y: 30, rotateX: 20 },
    { opacity: 1, y: 0, rotateX: 0,
      duration: 0.55,
      stagger: 0.1,
      ease: 'power3.out',
      transformPerspective: 600,
    },
    '-=0.3'
  );

  // Code preview
  tl.fromTo('#landing-code-preview',
    { opacity: 0, y: 30, scale: 0.97 },
    { opacity: 1, y: 0, scale: 1, duration: 0.6,
      ease: 'power3.out',
      onComplete: () => startTypewriter(),
    },
    '-=0.2'
  );

  // Scroll hint
  tl.fromTo('#scroll-hint',
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.4 },
    '-=0.2'
  );

  // Footer
  tl.fromTo('.landing-footer',
    { opacity: 0, y: 8 },
    { opacity: 1, y: 0, duration: 0.35 },
    '-=0.15'
  );

  // After entrance, start word morph cycle
  tl.call(() => startWordMorph(), [], '+=0.5');
}

// ── Typewriter Code Data ─────────────────────────────────────────
const TYPEWRITER_CODE = [
  { text: '# THETA172 · Python by design\n', cls: 'cp-comment' },
  { text: 'def ' , cls: 'cp-keyword' },
  { text: 'create', cls: 'cp-fn' },
  { text: '(idea):\n' },
  { text: '    ' },
  { text: 'result', cls: 'cp-fn' },
  { text: ' = ' },
  { text: 'f"Built: {idea}"', cls: 'cp-str' },
  { text: '\n    ' },
  { text: 'return', cls: 'cp-keyword' },
  { text: ' result\n\n' },
  { text: 'print', cls: 'cp-builtin' },
  { text: '(' },
  { text: 'create', cls: 'cp-fn' },
  { text: '(' },
  { text: '"something great"', cls: 'cp-str' },
  { text: '))' },
];

const TYPEWRITER_TERMINAL = [
  { text: '>>> ', cls: 'term-prompt', delay: 200 },
  { text: 'Built: something great', cls: 'term-output', delay: 60, charByChar: true },
];

// ── Typewriter Animation ─────────────────────────────────────────
export function startTypewriter() {
  const codeEl = document.getElementById('typing-code');
  const termEl = document.getElementById('typing-terminal');
  if (!codeEl || !termEl) return;

  let codeIndex = 0;
  let charIndex = 0;

  function typeNextCode() {
    if (codeIndex >= TYPEWRITER_CODE.length) {
      setTimeout(() => typeTerminal(0), 600);
      return;
    }
    const chunk = TYPEWRITER_CODE[codeIndex];
    const char  = chunk.text[charIndex];

    if (char === '\n') {
      codeEl.appendChild(document.createTextNode('\n'));
    } else {
      if (chunk.cls) {
        let span = codeEl.querySelector(`[data-chunk="${codeIndex}"]`);
        if (!span) {
          span = document.createElement('span');
          span.className = chunk.cls;
          span.dataset.chunk = codeIndex;
          codeEl.appendChild(span);
        }
        span.textContent += char;
      } else {
        let tn = codeEl.querySelector(`[data-tchunk="${codeIndex}"]`);
        if (!tn) {
          tn = document.createElement('span');
          tn.dataset.tchunk = codeIndex;
          codeEl.appendChild(tn);
        }
        tn.textContent += char;
      }
    }

    charIndex++;
    if (charIndex >= chunk.text.length) {
      codeIndex++;
      charIndex = 0;
    }

    const speed = char === '\n' ? 60 : 16 + Math.random() * 26;
    setTimeout(typeNextCode, speed);
  }

  function typeTerminal(idx) {
    if (idx >= TYPEWRITER_TERMINAL.length) {
      // Add blinking cursor at end
      const cursor = document.createElement('span');
      cursor.className = 'term-cursor';
      cursor.innerHTML = '&nbsp;';
      termEl.appendChild(cursor);
      return;
    }

    const item = TYPEWRITER_TERMINAL[idx];

    if (item.text === '\n') {
      termEl.appendChild(document.createElement('br'));
      setTimeout(() => typeTerminal(idx + 1), item.delay || 100);
      return;
    }

    const span = document.createElement('span');
    if (item.cls) span.className = item.cls;
    termEl.appendChild(span);

    if (item.charByChar) {
      let ci = 0;
      function typeChar() {
        if (ci >= item.text.length) {
          setTimeout(() => typeTerminal(idx + 1), item.delay || 100);
          return;
        }
        span.textContent += item.text[ci];
        ci++;
        setTimeout(typeChar, 50 + Math.random() * 35);
      }
      typeChar();
    } else {
      gsap.fromTo(span,
        { opacity: 0 },
        { opacity: 1, duration: 0.18, ease: 'power2.out',
          onComplete: () => setTimeout(() => typeTerminal(idx + 1), item.delay || 100)
        }
      );
      span.textContent = item.text;
    }
  }

  typeNextCode();
}

// ── Init Landing ─────────────────────────────────────────────────
export function initLanding($particlesContainer) {
  createParticles($particlesContainer);
  initCodeStream();
  initLandingSmoothness();

  // Kill CSS-driven animations — GSAP takes full ownership
  document.querySelectorAll(
    '.landing-nav, .landing-hero__label, .landing-hero__title, ' +
    '.landing-hero__sub, .btn-launch-main, .landing-hero__meta, ' +
    '#landing-accent-block, .landing-stat-card, #landing-code-preview, ' +
    '#scroll-hint, .landing-footer'
  ).forEach(el => {
    el.style.animation = 'none';
    el.style.opacity   = '0';
  });

  // Wait for fonts then fire
  const fire = () => animateLandingEntrance();
  if (document.fonts?.ready) {
    document.fonts.ready.then(fire);
  } else {
    setTimeout(fire, 120);
  }

  // Init 3D tilt after entrance animation completes
  setTimeout(initTiltCards, 1200);
}

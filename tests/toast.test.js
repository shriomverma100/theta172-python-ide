// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildToastElement } from '../src/toast.js';

describe('toast', () => {
  it('renders network-supplied text as text, never HTML', () => {
    const el = buildToastElement('<img src=x onerror="window.pwned=1"> joined', { color: '#fff', icon: '<path d="M0 0"/>' });
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('span').textContent).toBe('<img src=x onerror="window.pwned=1"> joined');
    expect(window.pwned).toBeUndefined();
  });

  it('keeps the trusted icon markup', () => {
    const el = buildToastElement('ok', { color: '#fff', icon: '<path d="M0 0"/>' });
    expect(el.querySelector('svg path')).not.toBeNull();
  });
});

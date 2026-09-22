// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LotusIllustration } from './lotus-illustration';

/**
 * The hero lotus is decoration that moves once, so two things must hold.
 *
 * It is invisible to assistive tech — five petals are not content. And every element
 * that animates carries its reduced-motion escape. happy-dom cannot evaluate
 * `prefers-reduced-motion`, so this checks the class is PRESENT on each animated
 * element — the same approach `skin-guard.spec.ts` takes — and the real check, that
 * nothing on `/` animates under `reducedMotion: 'reduce'`, is run in Chromium.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<LotusIllustration />);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('LotusIllustration', () => {
  it('draws five petals and hides them from assistive tech', () => {
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelectorAll('path')).toHaveLength(5);
  });

  it('pairs every animated petal with a reduced-motion escape', () => {
    const animated = [...container.querySelectorAll('[class*="animate-"]')];
    expect(animated.length).toBeGreaterThan(0);
    for (const element of animated) {
      expect(element.getAttribute('class')).toContain('motion-reduce:animate-none');
    }
  });

  it('rests each petal at its own angle, which is where reduced motion leaves it', () => {
    const angles = [...container.querySelectorAll('path')].map((petal) => petal.style.transform);
    expect(angles).toEqual([
      'rotate(-66deg)',
      'rotate(66deg)',
      'rotate(-33deg)',
      'rotate(33deg)',
      'rotate(0deg)',
    ]);
  });
});

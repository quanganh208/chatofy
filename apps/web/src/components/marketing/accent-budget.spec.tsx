// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FooterCta } from './footer-cta';
import { Hero } from './hero';
import { HowItWorks } from './how-it-works';
import { LocalSpeech } from './local-speech';
import { Surfaces } from './surfaces';

/**
 * One filled control per section, mechanically.
 *
 * "One accent-filled control per screen" is a visual rule with no full mechanical check
 * — a page-level count would wrongly fail the legitimate hero-CTA-plus-footer-CTA pair,
 * which are a viewport apart and both correct. The SECTION is the unit that genuinely
 * owns at most one, and a marketing page is exactly where someone reaches for a filled
 * button in every band. That is the sprawl this catches.
 *
 * The composed page stays a review item; this covers the part that is checkable.
 *
 * The sections are called rather than mounted as children. They are synchronous server
 * components — every string comes from the dictionary and nothing is awaited — so
 * calling one is just getting its tree.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SECTIONS = [
  { name: 'Hero', render: Hero, filled: 1 },
  { name: 'HowItWorks', render: HowItWorks, filled: 0 },
  { name: 'LocalSpeech', render: LocalSpeech, filled: 0 },
  { name: 'Surfaces', render: Surfaces, filled: 0 },
  { name: 'FooterCta', render: FooterCta, filled: 1 },
] as const;

let root: Root | undefined;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
});

describe('the landing page accent budget', () => {
  it.each(SECTIONS)('$name renders $filled filled controls', ({ render, filled }) => {
    const element = render();
    act(() => {
      root = createRoot(container);
      root.render(element);
    });

    // The class, not the variant attribute: what makes a control read as THE action is
    // the accent fill, and a hand-written `bg-primary` on something that is not a
    // Button spends the same budget.
    expect(container.querySelectorAll('[class*="bg-primary"]').length).toBe(filled);
    expect(container.textContent?.length ?? 0, 'the section rendered nothing').toBeGreaterThan(20);
  });
});

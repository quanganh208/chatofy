// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accentFilledControls } from '@/design/accent-count';

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
 * The sections are awaited into elements rather than mounted as children. They are
 * async server components — resolving the locale awaits a cookie — and `await`ing one
 * outside a request is fine here because `getT` is mocked to the English dictionary.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `getT` reads a cookie through `next/headers`, which only exists inside a request.
// The dictionary is the thing under test here, not the resolution, so it is handed
// over directly.
vi.mock('@/i18n/server', async () => {
  const { createTranslator, en } = await import('@chatofy/i18n');
  return { getT: () => Promise.resolve(createTranslator(en)) };
});

// SIGNED OUT, deliberately and narrowly. `FooterCta` reads the session to decide
// whether to ask a visitor to start translating, and the signed-out page is what
// these counts were written against — it is the page with the most filled controls
// on it, so it is the one worth holding a ceiling over. A mock that returned a
// session would quietly count a DIFFERENT page and still pass.
vi.mock('@/../auth', () => ({ auth: () => Promise.resolve(null) }));

const { Hero } = await import('./hero');
const { HowItWorks } = await import('./how-it-works');
const { LocalSpeech } = await import('./local-speech');
const { Surfaces } = await import('./surfaces');
const { FooterCta } = await import('./footer-cta');

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
  it.each(SECTIONS)('$name renders $filled filled controls', async ({ render, filled }) => {
    const element = await render();
    await act(async () => {
      root = createRoot(container);
      root.render(element);
      await Promise.resolve();
    });

    // The class, not the variant attribute: what makes a control read as THE action is
    // the accent fill, and a hand-written `bg-primary` on something that is not a
    // Button spends the same budget. The counting itself is shared with the
    // screen-level app spec — two gates for one rule must not drift into two
    // definitions of "accent-filled".
    expect(accentFilledControls(container).length).toBe(filled);
    expect(container.textContent?.length ?? 0, 'the section rendered nothing').toBeGreaterThan(20);
  });
});

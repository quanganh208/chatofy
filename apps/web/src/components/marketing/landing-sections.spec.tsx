// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The redesigned landing's own promises, beyond the accent budget:
 *
 * - every anchor the header and footer point at lands on a section that renders it;
 * - the pricing band states the Free allowance only from plan rows, always says checkout
 *   is not open, and offers no way to buy;
 * - the FAQ renders the whole list through the shared accordion, and opens an answer;
 * - the mockups are pictures: hidden from assistive technology and free of controls.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/i18n/server', async () => {
  const { createTranslator, en } = await import('@chatofy/i18n');
  return {
    getT: () => Promise.resolve(createTranslator(en)),
    getLocale: () => Promise.resolve('en'),
  };
});
vi.mock('@/../auth', () => ({ auth: () => Promise.resolve(null) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }) }));

const { en } = await import('@chatofy/i18n');
const { LocaleProvider } = await import('@/i18n/provider');
const { MarketingHeader } = await import('@/components/layout/marketing-header');
const { MarketingFooter } = await import('@/components/layout/marketing-footer');
const { Hero } = await import('./hero');
const { Modes } = await import('./modes');
const { HowItWorks } = await import('./how-it-works');
const { UseCases } = await import('./use-cases');
const { RecordingPrivacy } = await import('./recording-privacy');
const { Surfaces } = await import('./surfaces');
const { PricingTeaser } = await import('./pricing-teaser');
const { Faq } = await import('./faq');
const { FooterCta } = await import('./footer-cta');
const { LANDING_FAQ } = await import('@/lib/landing-faq');
const { SEEDED_PLANS } = await import('@/lib/seeded-plans.fixture');

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

async function mount(elements: React.ReactNode[]) {
  await act(async () => {
    root = createRoot(container);
    root.render(<LocaleProvider>{elements}</LocaleProvider>);
    await Promise.resolve();
  });
}

describe('the landing page', () => {
  it('has a section for every anchor the header and footer link', async () => {
    const page = await Promise.all([
      MarketingHeader(),
      Hero(),
      Modes(),
      HowItWorks(),
      UseCases(),
      RecordingPrivacy(),
      Surfaces(),
      PricingTeaser({ plans: SEEDED_PLANS }),
      Faq(),
      FooterCta(),
      MarketingFooter(),
    ]);
    await mount(page);

    const anchors = [...container.querySelectorAll('a[href^="/#"]')].map((a) =>
      a.getAttribute('href')!.slice(2),
    );
    expect(anchors.length).toBeGreaterThanOrEqual(6);
    for (const id of new Set(anchors)) {
      expect(container.querySelector(`section#${id}`), `#${id}`).not.toBeNull();
    }
  });

  it('draws its mockups as pictures: hidden, and holding no control', async () => {
    await mount([await Hero(), await Modes()]);
    const pictures = [...container.querySelectorAll('[aria-hidden="true"]')].filter(
      (el) => (el.textContent?.length ?? 0) > 20,
    );
    expect(pictures.length).toBeGreaterThanOrEqual(6);
    for (const picture of pictures) {
      expect(picture.querySelector('a, button, input, [tabindex]')).toBeNull();
    }
  });
});

describe('PricingTeaser', () => {
  it('states the Free allowance from the plan rows, and how to see the rest', async () => {
    await mount([await PricingTeaser({ plans: SEEDED_PLANS })]);
    const free = SEEDED_PLANS.find((plan) => plan.kind === 'free')!;
    expect(container.textContent).toContain(`${free.credits} credits every month`);
    expect(container.textContent).toContain(en['web.pricing.notOpen']);
    expect(container.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(container.querySelector('a[href="/register"], a[href*="checkout"]')).toBeNull();
  });

  it('names no count when the plans could not be loaded', async () => {
    await mount([await PricingTeaser({ plans: null })]);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).toContain(en['web.pricing.notOpen']);
  });
});

describe('Faq', () => {
  it('asks every question and opens an answer through the shared accordion', async () => {
    await mount([await Faq()]);
    const triggers = [...container.querySelectorAll('[data-slot="accordion-trigger"]')];
    expect(triggers.map((el) => el.textContent)).toEqual(
      LANDING_FAQ.map((topic) => en[`web.landing.faq${topic}Question`]),
    );

    const answer = en['web.landing.faqHeadphonesAnswer'];
    expect(container.textContent).not.toContain(answer);
    await act(async () => {
      (triggers[2] as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(triggers[2]?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain(answer);
  });
});

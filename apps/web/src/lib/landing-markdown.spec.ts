import { createTranslator, en, vi, zh, type Messages } from '@chatofy/i18n';
import { describe, expect, it } from 'vitest';
import { SEEDED_PLANS } from './seeded-plans.fixture';
import { landingMarkdown, llmsTxt } from './landing-markdown';

/**
 * The markdown twin must say what the landing page says, in every locale.
 *
 * It walks every `web.landing.*` key rather than a hand-kept list, so a section
 * added to the page fails here until the twin carries it too — a twin that quietly
 * lags the HTML is the drift this exists to stop.
 *
 * Exempt, with reasons: the nav labels, the menu title and the footer's labels are
 * chrome, not content; the italic phrase is a substring of the headline; the hero
 * strip restates the hero body as pills; and the demo card and the bento mockups
 * (`demo*`, `mock*`) are illustrations of the product, not claims about it.
 */
const CHROME = new Set<keyof Messages>([
  'web.landing.navMenu',
  'web.landing.navModes',
  'web.landing.navHow',
  'web.landing.navUseCases',
  'web.landing.navPricing',
  'web.landing.navFaq',
  'web.landing.navLocal',
  'web.landing.navSurfaces',
  'web.landing.heroTitleEmphasis',
  'web.landing.heroLanguagesLabel',
  'web.landing.heroPlatformsLabel',
  'web.landing.heroPlatformBrowser',
  'web.landing.footerProduct',
  'web.landing.footerOnThisPage',
  'web.landing.footerResources',
  'web.landing.footerLanguages',
  'web.landing.footerMarkdownHome',
  'web.landing.footerMarkdownPricing',
]);
const isContent = (key: keyof Messages) =>
  !CHROME.has(key) && !/^web\.landing\.(demo|mock)[A-Z]/.test(key);

const ORIGIN = 'https://chatofy.example';

describe.each([
  ['en', en],
  ['vi', vi],
  ['zh', zh],
] as const)('the landing markdown (%s)', (locale, messages) => {
  const markdown = landingMarkdown(createTranslator(messages), ORIGIN, locale, SEEDED_PLANS);

  it('opens with the page title and the canonical URL', () => {
    expect(markdown.startsWith(`# ${messages['web.meta.home']}\n`)).toBe(true);
    expect(markdown).toContain(`Canonical: ${ORIGIN}/`);
  });

  it('carries every landing string the page renders', () => {
    const missing = (Object.keys(messages) as (keyof Messages)[])
      .filter((key) => key.startsWith('web.landing.') && isContent(key))
      .filter((key) => !markdown.includes(messages[key]));
    expect(missing).toEqual([]);
  });

  it('offers both halves of the product, as the hero does', () => {
    expect(markdown).toContain(`](${ORIGIN}/translate/one-way)`);
    expect(markdown).toContain(`](${ORIGIN}/conference)`);
    expect(markdown).toContain(`## ${messages['web.landing.meetingsTitle']}`);
  });

  it('links absolutely, so an agent can follow it without the page', () => {
    for (const [, href] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      expect(href).toMatch(/^https:\/\//);
    }
  });
});

describe('llms.txt', () => {
  const text = llmsTxt(createTranslator(en), ORIGIN);

  it('has the llmstxt.org shape and points at the absolute twin', () => {
    expect(text.startsWith('# Chatofy\n\n> ')).toBe(true);
    expect(text).toContain('## Pages');
    expect(text).toContain(`](${ORIGIN}/index.md)`);
  });

  it('links the pricing twin, so an agent can find the prices without the page', () => {
    expect(text).toContain(`[${en['web.meta.pricing']}](${ORIGIN}/pricing.md)`);
  });
});

describe('the landing markdown without plans', () => {
  it('names no allowance and still says checkout is not open', () => {
    const t = createTranslator(en);
    const withPlans = landingMarkdown(t, ORIGIN, 'en', SEEDED_PLANS);
    const without = landingMarkdown(t, ORIGIN, 'en', null);
    const free = SEEDED_PLANS.find((plan) => plan.kind === 'free')!;
    expect(withPlans).toContain(`${free.credits} credits every month`);
    expect(without).not.toContain(`${free.credits} credits`);
    expect(without).toContain(en['web.pricing.notOpen']);
    expect(without).toContain(`](${ORIGIN}/pricing.md)`);
  });
});

describe('llms.txt sections', () => {
  it('points at every landing section an agent might want by anchor', () => {
    const text = llmsTxt(createTranslator(en), ORIGIN);
    for (const id of ['modes', 'how-it-works', 'use-cases', 'privacy', 'pricing', 'faq']) {
      expect(text).toContain(`](${ORIGIN}/#${id})`);
    }
  });
});

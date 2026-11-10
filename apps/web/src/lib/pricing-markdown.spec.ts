import { createTranslator, en, vi, type Messages } from '@chatofy/i18n';
import { describe, expect, it } from 'vitest';
import { pricingContent } from './pricing-content';
import { pricingMarkdown } from './pricing-markdown';
import { SEEDED_PLANS } from './seeded-plans.fixture';

/**
 * The pricing twin must say what `/pricing` says, in every locale.
 *
 * It walks every `web.pricing.*` key rather than a hand-kept list, so a line added to
 * the page fails here until the twin carries it. A key with a placeholder is checked by
 * the longest stretch of its text between placeholders: the number is the plan row's, not the key's.
 */
const ORIGIN = 'https://chatofy.example';

/** Shown only when the plans did not load; checked by the failure case instead. */
const ONLY_ON_FAILURE = new Set<keyof Messages>(['web.pricing.pricesUnavailable']);

/** The longest run of a template that no placeholder interrupts. */
const fixedText = (template: string) =>
  template
    .split(/\{\w+\}/)
    .map((part) => part.trim())
    .reduce((longest, part) => (part.length > longest.length ? part : longest), '');

describe.each([
  ['en', en],
  ['vi', vi],
] as const)('the pricing markdown (%s)', (locale, messages) => {
  const t = createTranslator(messages);
  const meta = {
    title: messages['web.meta.pricing'],
    description: messages['web.meta.pricingDescription'],
  };
  const markdown = pricingMarkdown(pricingContent(t, locale, SEEDED_PLANS), meta, ORIGIN);

  it('opens with the title, then the canonical URL', () => {
    expect(markdown.startsWith(`# ${meta.title}\n`)).toBe(true);
    expect(markdown).toContain(`Canonical: ${ORIGIN}/pricing`);
  });

  it('puts the not-open notice before any price', () => {
    const notice = markdown.indexOf(messages['web.pricing.notOpen']);
    expect(notice).toBeGreaterThan(0);
    expect(notice).toBeLessThan(markdown.indexOf(messages['common.billing.planFree']));
  });

  it('carries every pricing string the page renders', () => {
    const missing = (Object.keys(messages) as (keyof Messages)[])
      .filter((key) => key.startsWith('web.pricing.') && !ONLY_ON_FAILURE.has(key))
      .filter((key) => !markdown.includes(fixedText(messages[key])));
    expect(missing).toEqual([]);
  });

  it('links absolutely, so an agent can follow it without the page', () => {
    const hrefs = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(([, href]) => href);
    expect(hrefs).toEqual([`${ORIGIN}/register`]);
  });

  it('says the prices are unavailable, and quotes none, when the plans did not load', () => {
    const down = pricingMarkdown(pricingContent(t, locale, null), meta, ORIGIN);
    expect(down).toContain(messages['web.pricing.pricesUnavailable']);
    expect(down).toContain(messages['web.pricing.notOpen']);
    expect(down).not.toMatch(/[$₫]/);
  });
});

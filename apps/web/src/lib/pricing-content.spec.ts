import { createTranslator, en, vi } from '@chatofy/i18n';
import type { Plan } from '@chatofy/types';
import { describe, expect, it } from 'vitest';
import { pricingContent, pricingOffers } from './pricing-content';
import { SEEDED_PLANS } from './seeded-plans.fixture';

const t = createTranslator(en);

describe('pricingContent', () => {
  it('reads every number from the plan rows', () => {
    const content = pricingContent(t, 'en', SEEDED_PLANS);
    const [free, pro, topups] = content.bands;

    expect(free?.summary).toBe('120 credits every month. Unused credits do not carry over.');
    expect(pro?.summary).toContain('600 credits each cycle');
    expect(pro?.lines).toEqual([
      '$9.99 a month by card, renews automatically',
      '₫249,000 for 30 days by VietQR, does not renew',
    ]);
    // A pack's rails do not hide its price: rails say where it can be bought NOW, the
    // page says what it costs.
    expect(topups?.lines).toEqual([
      '250 credits · $5.00 by card · ₫125,000 by VietQR',
      '550 credits · $10.00 by card · ₫250,000 by VietQR',
      '1,500 credits · $25.00 by card · ₫625,000 by VietQR',
    ]);
    expect(content.unavailable).toBeUndefined();
  });

  it('formats prices in the reader locale', () => {
    const content = pricingContent(createTranslator(vi), 'vi', SEEDED_PLANS);
    expect(content.bands[1]?.lines[1]).toContain('249.000');
  });

  it('keeps the bands and drops every number when the plans did not load', () => {
    const content = pricingContent(t, 'en', null);
    expect(content.unavailable).toBe(en['web.pricing.pricesUnavailable']);
    expect(content.bands.map((band) => band.title)).toEqual(['Free', 'Pro', 'Top-ups']);
    expect(content.bands.flatMap((band) => band.lines)).toEqual([]);
    expect(content.bands[0]?.summary).toBeUndefined();
    // The footnotes' unit rates are copy, not plan rows; the bands carry no number.
    expect(JSON.stringify(content.bands)).not.toMatch(/\d/);
  });

  it('shows the one price a pack has when it is sold on one rail only', () => {
    const cardOnly: Plan = { ...SEEDED_PLANS[3]!, priceVnd: null };
    expect(pricingContent(t, 'en', [cardOnly]).bands[2]?.lines).toEqual(['250 credits · $5.00']);
  });
});

describe('pricingOffers', () => {
  const offers = pricingOffers(t, 'en', SEEDED_PLANS);

  it('is one offer per visible price, in both currencies, and never Free', () => {
    // 1 card price for Pro, 1 VietQR price for the pass, 2 for each of 3 packs.
    expect(offers).toHaveLength(8);
    expect(offers.map((offer) => offer.priceCurrency).sort()).toEqual([
      'USD',
      'USD',
      'USD',
      'USD',
      'VND',
      'VND',
      'VND',
      'VND',
    ]);
    expect(offers.some((offer) => offer.name === 'Free')).toBe(false);
    expect(offers).toContainEqual(
      expect.objectContaining({ name: 'Pro', price: '9.99', priceCurrency: 'USD' }),
    );
    expect(offers).toContainEqual(
      expect.objectContaining({ name: 'Pro', price: '249000', priceCurrency: 'VND' }),
    );
  });

  it('says on every offer that checkout is not open to the public', () => {
    expect(offers.every((offer) => offer.description === en['web.pricing.notOpen'])).toBe(true);
  });
});

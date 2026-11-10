import type { Locale, Translate } from '@chatofy/i18n';
import type { Plan } from '@chatofy/types';

/**
 * What `/pricing` says, resolved once from the dictionary and the plan rows.
 *
 * The page, its markdown twin and its JSON-LD all read this, so none of the three can
 * state a price the others do not: a twin that drifts from the HTML, or markup that
 * disagrees with visible content, is the failure this shape exists to prevent.
 *
 * Every number comes from a `Plan` row. Nothing here knows that Free is 120 credits or
 * that Pro is $9.99 — those are database rows, and a price written into the copy would
 * stay wrong the day the row changes.
 */
export type PricingBandId = 'free' | 'pro' | 'topups';

export interface PricingBand {
  id: PricingBandId;
  title: string;
  /** What the band gives. Absent when the plans could not be loaded: it names a count. */
  summary?: string;
  /** One line per way to pay, or per top-up pack. Empty without plans. */
  lines: string[];
}

export interface PricingContent {
  title: string;
  notOpen: string;
  intro: string;
  startFree: string;
  bands: PricingBand[];
  /** Set only when the plans could not be loaded; the page shows it in place of prices. */
  unavailable?: string;
  footnotes: string[];
}

/** A price in US cents, in the reader's locale: `$9.99`, `9,99 US$`. */
export function formatUsd(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** A price in whole đồng, in the reader's locale: `₫249,000`, `249.000 ₫`. */
export function formatVnd(dong: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'VND' }).format(dong);
}

/** "1 credit" / "1,500 credits", through the dictionary's hand-written plural. */
export function creditAmount(t: Translate, credits: number, locale: Locale): string {
  if (credits === 1) return t('common.billing.creditAmountOne');
  return t('common.billing.creditAmount', {
    credits: new Intl.NumberFormat(locale).format(credits),
  });
}

/** A top-up's price line: both rails when it is sold on both, else the one it has. */
function topupPrice(t: Translate, plan: Plan, locale: Locale): string | null {
  const usd = plan.priceUsdCents === null ? null : formatUsd(plan.priceUsdCents, locale);
  const vnd = plan.priceVnd === null ? null : formatVnd(plan.priceVnd, locale);
  if (usd && vnd) return t('web.pricing.topupPrice', { usd, vnd });
  return usd ?? vnd;
}

/**
 * The page's content. `plans` is `null` when `GET /billing/plans` failed: the bands keep
 * their titles, lose every number, and the page says the prices are unavailable.
 */
export function pricingContent(t: Translate, locale: Locale, plans: Plan[] | null): PricingContent {
  const count = (credits: number) => new Intl.NumberFormat(locale).format(credits);
  const free = plans?.find((plan) => plan.kind === 'free');
  const card = plans?.find((plan) => plan.kind === 'subscription');
  const pass = plans?.find((plan) => plan.kind === 'pass');
  const topups = plans?.filter((plan) => plan.kind === 'topup') ?? [];
  const pro = card ?? pass;

  const proLines: string[] = [];
  if (card?.priceUsdCents != null) {
    proLines.push(t('web.pricing.proPriceCard', { price: formatUsd(card.priceUsdCents, locale) }));
  }
  if (pass?.priceVnd != null) {
    proLines.push(t('web.pricing.proPricePass', { price: formatVnd(pass.priceVnd, locale) }));
  }

  const bands: PricingBand[] = [
    {
      id: 'free',
      title: t('common.billing.planFree'),
      summary: free ? t('web.pricing.freeSummary', { credits: count(free.credits) }) : undefined,
      lines: [],
    },
    {
      id: 'pro',
      title: t('common.billing.planPro'),
      summary: pro ? t('web.pricing.proSummary', { credits: count(pro.credits) }) : undefined,
      lines: proLines,
    },
    {
      id: 'topups',
      title: t('web.pricing.topupsTitle'),
      // No number in it, so it stays when the plans do not load.
      summary: t('web.pricing.topupsSummary'),
      lines: topups.flatMap((plan) => {
        const price = topupPrice(t, plan, locale);
        const amount = creditAmount(t, plan.credits, locale);
        return price ? [`${amount} · ${price}`] : [];
      }),
    },
  ];

  return {
    title: t('web.pricing.title'),
    notOpen: t('web.pricing.notOpen'),
    intro: t('web.pricing.intro'),
    startFree: t('web.pricing.startFree'),
    bands,
    unavailable: plans === null ? t('web.pricing.pricesUnavailable') : undefined,
    footnotes: [t('web.pricing.footnoteUnits'), t('web.pricing.footnoteLanguages')],
  };
}

/**
 * One schema.org `Offer` per price a visitor can see on the page: a plan sold on both
 * rails is two offers, one per currency. Free has no price row and is not an offer —
 * the page shows no "$0", and markup must not say what the page does not.
 *
 * Each carries the not-open notice as its description: the offer exists and is priced,
 * and it is not for sale to the public, and a reader of the markup alone must learn both.
 */
export function pricingOffers(t: Translate, locale: Locale, plans: Plan[]) {
  const notOpen = t('web.pricing.notOpen');
  const nameOf = (plan: Plan) =>
    plan.kind === 'topup'
      ? `${t('web.pricing.topupsTitle')}: ${creditAmount(t, plan.credits, locale)}`
      : plan.kind === 'free'
        ? t('common.billing.planFree')
        : t('common.billing.planPro');

  return plans.flatMap((plan) => {
    const offers: Record<string, string>[] = [];
    if (plan.priceUsdCents !== null) {
      offers.push({
        '@type': 'Offer',
        name: nameOf(plan),
        price: (plan.priceUsdCents / 100).toFixed(2),
        priceCurrency: 'USD',
        description: notOpen,
      });
    }
    if (plan.priceVnd !== null) {
      offers.push({
        '@type': 'Offer',
        name: nameOf(plan),
        price: String(plan.priceVnd),
        priceCurrency: 'VND',
        description: notOpen,
      });
    }
    return offers;
  });
}

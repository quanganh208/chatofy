import type { Locale, Translate } from '@chatofy/i18n';
import { creditsFromSeconds } from '@chatofy/types';
import { creditAmount } from '@/lib/pricing-content';

/**
 * Credit amounts and dates as Settings › Billing, `/translate` and the QR panel say
 * them. Prices and the credit plural come from `pricing-content.ts`, which
 * `/pricing` reads too, so a number is never formatted two ways.
 *
 * Amounts arrive from the API already in credits with at most 2 decimals; a WS
 * event carries credit-seconds and is converted through the shared
 * `creditsFromSeconds`, never by a local division.
 */

/** "1 credit", "2.5 credits". */
export function formatCredits(t: Translate, locale: Locale, credits: number): string {
  return creditAmount(t, credits, locale);
}

/** The same, from the credit-seconds a `server.error` carries. */
export function formatCreditSeconds(t: Translate, locale: Locale, seconds: number): string {
  return formatCredits(t, locale, creditsFromSeconds(seconds));
}

/**
 * A day in the reader's own calendar. An unparseable value renders as itself
 * rather than "Invalid Date".
 */
export function formatDay(locale: Locale, iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

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

/** The minus sign, U+2212: `Intl` writes a hyphen-minus, which sets short and thin. */
const MINUS = '\u2212';

/**
 * "1 credit", "2.5 credits", "−3 credits". A negative amount takes a true minus
 * sign in every locale rather than the hyphen `Intl` would write, so a debit reads
 * the same here as in {@link formatSignedCredits}.
 */
export function formatCredits(t: Translate, locale: Locale, credits: number): string {
  if (credits < 0) return MINUS + creditAmount(t, -credits, locale);
  return creditAmount(t, credits, locale);
}

/** A ledger amount with its sign always shown: "+120 credits", "−12.5 credits", "0 credits". */
export function formatSignedCredits(t: Translate, locale: Locale, credits: number): string {
  return credits > 0 ? `+${formatCredits(t, locale, credits)}` : formatCredits(t, locale, credits);
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

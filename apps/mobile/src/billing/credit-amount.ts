/**
 * Credit amounts in words. The API already sends credits rounded to two
 * decimals, so this only formats: grouping, no trailing zeros, and the English
 * singular the catalogue writes by hand (it has no plural rules).
 */

import type { MessageKey } from '@chatofy/i18n';

export interface CreditMessage {
  key: MessageKey;
  vars?: { credits: string };
}

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** "1 credit", "2.5 credits". The sign is dropped; a caller that shows one adds it. */
export function creditAmountMessage(credits: number): CreditMessage {
  const magnitude = Math.abs(credits);
  if (magnitude === 1) return { key: 'common.billing.creditAmountOne' };
  return { key: 'common.billing.creditAmount', vars: { credits: NUMBER.format(magnitude) } };
}

/** The sign a usage row leads with: spends read "−", grants "+", a zero row nothing. */
export function creditSign(credits: number): string {
  if (credits > 0) return '+';
  if (credits < 0) return '−';
  return '';
}

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A reset date or a usage row's day, e.g. "Dec 1, 2026". An unreadable value is shown as sent. */
export function creditDate(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : DAY.format(at);
}

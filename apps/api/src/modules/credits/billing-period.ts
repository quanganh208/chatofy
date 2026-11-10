// The billing month, which is the calendar month in Vietnam.
//
// The Free allowance resets on the 1st where the users are, not at UTC midnight:
// a grant keyed by the UTC month would hand out December's credits at 07:00 on
// 1 December and, worse, treat 1 December 03:00 local as still November.
//
// Asia/Saigon is a fixed UTC+7 with no daylight saving (none since 1975), so
// the arithmetic below is a fixed offset rather than a timezone database lookup;
// the boundary spec pins it.

const SAIGON_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The billing zone, for SQL that groups by local day. */
export const BILLING_TIME_ZONE = 'Asia/Saigon';

function localParts(now: Date): { year: number; month: number } {
  const local = new Date(now.getTime() + SAIGON_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() };
}

function monthStartInstant(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1) - SAIGON_OFFSET_MS);
}

/** `YYYY-MM` of the local month `now` falls in. */
export function billingMonthKey(now: Date): string {
  const { year, month } = localParts(now);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** The first instant of the local month `now` falls in. */
export function billingMonthStart(now: Date): Date {
  const { year, month } = localParts(now);
  return monthStartInstant(year, month);
}

/** The first instant of the local month after the one `now` falls in. */
export function nextBillingMonthStart(now: Date): Date {
  const { year, month } = localParts(now);
  return monthStartInstant(year, month + 1);
}

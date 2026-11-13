import type { CreditUsageEntry } from '@chatofy/types';

/** One day of usage: its local calendar key and the entries written on it, in order. */
export interface UsageDay {
  /** `YYYY-MM-DD` in the reader's own time zone. */
  key: string;
  /** Any entry's timestamp from that day, for formatting the heading. */
  at: string;
  /** 0 for today, 1 for yesterday, more for older days; negative for a future clock. */
  daysAgo: number;
  entries: CreditUsageEntry[];
}

/** The local calendar day of a moment, as `YYYY-MM-DD`. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whole local calendar days from `then` to `now`, counted by date, not by 24 h spans. */
function daysBetween(then: Date, now: Date): number {
  const start = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  const end = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end - start) / 86_400_000);
}

/**
 * Usage entries (newest first, as the API pages them) grouped by the reader's local
 * day, keeping their order. An entry with an unparseable time is put with the day
 * before it rather than dropped, so a row the API sent never disappears.
 */
export function groupUsageByDay(entries: CreditUsageEntry[], now: Date = new Date()): UsageDay[] {
  const days: UsageDay[] = [];
  for (const entry of entries) {
    const at = new Date(entry.at);
    const valid = !Number.isNaN(at.getTime());
    const key = valid ? dayKey(at) : (days.at(-1)?.key ?? 'unknown');
    const last = days.at(-1);
    if (last && last.key === key) {
      last.entries.push(entry);
      continue;
    }
    days.push({
      key,
      at: entry.at,
      daysAgo: valid ? daysBetween(at, now) : Infinity,
      entries: [entry],
    });
  }
  return days;
}

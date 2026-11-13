import { describe, expect, it } from 'vitest';
import type { CreditUsageEntry } from '@chatofy/types';
import { groupUsageByDay } from './credit-usage-days';

function entry(id: string, at: string): CreditUsageEntry {
  return { id, at, kind: 'translate', credits: -1, conversationId: null, label: '' };
}

/** Local noon, so the local day is the same in every time zone the suite runs in. */
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('groupUsageByDay', () => {
  const now = new Date(2026, 10, 13, 15);

  it('groups consecutive entries by local day and keeps their order', () => {
    const days = groupUsageByDay(
      [
        entry('a', local(2026, 11, 13, 14)),
        entry('b', local(2026, 11, 13, 9)),
        entry('c', local(2026, 11, 12)),
        entry('d', local(2026, 11, 2)),
      ],
      now,
    );
    expect(days.map((day) => day.entries.map((e) => e.id))).toEqual([['a', 'b'], ['c'], ['d']]);
    expect(days.map((day) => day.daysAgo)).toEqual([0, 1, 11]);
  });

  it('counts calendar days, not 24-hour spans', () => {
    // 23:30 yesterday is "yesterday" at 00:30 today, though under an hour has passed.
    const [day] = groupUsageByDay(
      [entry('a', new Date(2026, 10, 12, 23, 30).toISOString())],
      new Date(2026, 10, 13, 0, 30),
    );
    expect(day?.daysAgo).toBe(1);
  });

  it('keeps an entry whose time does not parse, with the day before it', () => {
    const days = groupUsageByDay([entry('a', local(2026, 11, 13)), entry('b', 'not a date')], now);
    expect(days).toHaveLength(1);
    expect(days[0]?.entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('answers nothing for no entries', () => {
    expect(groupUsageByDay([], now)).toEqual([]);
  });
});

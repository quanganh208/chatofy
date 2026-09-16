import { describe, expect, it } from 'vitest';
import { TranslationBudget } from './translation-budget';

const LIVE_MODEL = 'gemini-3.5-flash-lite';
const SPECULATION_MODEL = 'gemini-3.1-flash-lite';

/** Budget with a clock the test drives, so nothing here sleeps. */
function makeBudget(options: { perUserRpm: number; globalRpm?: number }) {
  let clock = 1_000;
  const budget = new TranslationBudget({ ...options, now: () => clock });
  return {
    budget,
    advance: (ms: number) => {
      clock += ms;
    },
    spendTimes: (times: number, userId: string, model = LIVE_MODEL) => {
      for (let i = 0; i < times; i += 1) budget.spend(userId, model);
    },
  };
}

describe('TranslationBudget', () => {
  describe('the per-user tier', () => {
    it('stops a user once they have spent their minute', () => {
      const { budget, spendTimes } = makeBudget({ perUserRpm: 3 });
      spendTimes(3, 'user-a');
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(false);
    });

    it('lets everyone else keep going when one user runs out', () => {
      // The reason this tier exists at all: one person talking without pause
      // must not take the mid-sentence translations away from anybody else.
      const { budget, spendTimes } = makeBudget({
        perUserRpm: 3,
        globalRpm: 10,
      });
      spendTimes(3, 'user-a');
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(false);
      expect(budget.canSpend('user-b', LIVE_MODEL)).toBe(true);
    });
  });

  describe('the global tier', () => {
    it('stops everyone once the process ceiling is reached', () => {
      const { budget, spendTimes } = makeBudget({
        perUserRpm: 3,
        globalRpm: 6,
      });
      spendTimes(3, 'user-a');
      spendTimes(3, 'user-b');
      // `user-c` has spent nothing, and is refused anyway — the ceiling this
      // tier guards belongs to the process, not to any one speaker.
      expect(budget.canSpend('user-c', LIVE_MODEL)).toBe(false);
    });

    it('never sits below the per-user tier', () => {
      // A global ceiling under the per-user one would make the per-user number
      // unreachable, so it is raised to match rather than silently winning.
      const { budget, spendTimes } = makeBudget({
        perUserRpm: 5,
        globalRpm: 2,
      });
      spendTimes(4, 'user-a');
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(true);
    });
  });

  describe('the window', () => {
    it('slides rather than resetting on the minute', () => {
      const { budget, advance, spendTimes } = makeBudget({ perUserRpm: 2 });
      spendTimes(2, 'user-a');
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(false);
      advance(30_000);
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(false);
      advance(31_000);
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(true);
    });

    it('counts what the process spent in the last minute', () => {
      const { budget, advance, spendTimes } = makeBudget({ perUserRpm: 5 });
      spendTimes(3, 'user-a');
      expect(budget.spentLastMinute(LIVE_MODEL)).toBe(3);
      advance(61_000);
      expect(budget.spentLastMinute(LIVE_MODEL)).toBe(0);
    });
  });

  describe('models', () => {
    it('meters each model separately', () => {
      // Google's quota is per project per model, so a bucket blind to the model
      // would refuse requests that had quota waiting for them.
      const { budget, spendTimes } = makeBudget({ perUserRpm: 2 });
      spendTimes(2, 'user-a', LIVE_MODEL);
      expect(budget.canSpend('user-a', LIVE_MODEL)).toBe(false);
      expect(budget.canSpend('user-a', SPECULATION_MODEL)).toBe(true);
    });
  });

  describe('bookkeeping', () => {
    it('does not accumulate users who have gone quiet', () => {
      // Otherwise the map gains an entry for every user who has ever spoken and
      // never loses one, which on a long-lived process is a slow leak.
      //
      // Asserted across bursts rather than immediately after one, because the
      // map only ever GROWS on a spend: a process that has stopped spending has
      // stopped growing, so what matters is that yesterday's speakers are gone
      // by the time today's arrive, not that they vanish the instant their
      // minute lapses.
      const { budget, advance } = makeBudget({ perUserRpm: 5 });
      const inner = budget as unknown as { perUser: Map<string, number[]> };

      for (let i = 0; i < 100; i += 1)
        budget.spend(`old-user-${i}`, LIVE_MODEL);
      advance(61_000);
      for (let i = 0; i < 3; i += 1) budget.spend(`new-user-${i}`, LIVE_MODEL);

      expect(budget.spentLastMinute(LIVE_MODEL)).toBe(3);
      expect(inner.perUser.size).toBe(3);
    });
  });
});

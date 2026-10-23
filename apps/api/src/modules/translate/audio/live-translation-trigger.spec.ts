import { describe, expect, it } from 'vitest';
import { LiveTranslationTrigger } from './live-translation-trigger';
import { TranslationBudget } from './translation-budget';
import { LIVE_TRANSLATION_COMMIT_CHARS } from '../session/turn-tuning';

const MODEL = 'gemini-3.5-flash-lite';
const USER = 'user-a';

/** Trigger with a budget the test can starve on purpose. */
function makeTrigger(
  overrides: { commitChars?: number; perUserRpm?: number } = {},
) {
  const budget = new TranslationBudget({
    perUserRpm: overrides.perUserRpm ?? 100,
  });
  const trigger = new LiveTranslationTrigger({
    budget,
    commitChars: overrides.commitChars ?? 15,
    userId: USER,
    model: MODEL,
  });
  return { trigger, budget };
}

/** `length` characters of unpunctuated Vietnamese-shaped text. */
const settled = (length: number): string =>
  'a b c d e f g h i j '.repeat(20).slice(0, length);

describe('LiveTranslationTrigger', () => {
  it('reads the character rule for the language the turn settled in, at the time it settles', () => {
    let chars = 15;
    const trigger = new LiveTranslationTrigger({
      budget: new TranslationBudget({ perUserRpm: 100 }),
      commitChars: () => chars,
      userId: USER,
      model: MODEL,
    });

    expect(trigger.shouldTranslate(settled(10), 0)).toBe(false);
    // A two-way turn that locked in Chinese counts Han characters.
    chars = LIVE_TRANSLATION_COMMIT_CHARS.zh;
    expect(trigger.shouldTranslate(settled(10), 0)).toBe(true);
  });

  describe('when a translation is worth sending', () => {
    it('translates a short sentence that closes a clause', () => {
      // Under the old clock-driven policy a 2.5-second sentence got nothing at
      // all. That was the complaint, and this is the case that fixes it.
      const { trigger } = makeTrigger({ commitChars: 40 });
      expect(trigger.shouldTranslate('yesterday I booked a room,', 0)).toBe(
        true,
      );
    });

    it('translates once enough characters have settled', () => {
      const { trigger } = makeTrigger({ commitChars: 15 });
      expect(trigger.shouldTranslate(settled(20), 0)).toBe(true);
    });

    it('refuses while too little has settled and no clause has closed', () => {
      const { trigger } = makeTrigger({ commitChars: 40 });
      expect(trigger.shouldTranslate(settled(10), 0)).toBe(false);
    });

    it('refuses an empty or blank settled text', () => {
      const { trigger } = makeTrigger();
      expect(trigger.shouldTranslate('   ', 0)).toBe(false);
    });
  });

  describe('the character rule', () => {
    it('fires again and again as speech settles', () => {
      // The defect this guards: an earlier design decided on settled text but
      // recorded the full hypothesis, so the two were measured in different
      // units and the baseline jumped past anything the settled text could
      // reach. The rule fired once and was dead for the rest of the turn.
      const { trigger } = makeTrigger({ commitChars: 40 });

      for (const length of [40, 80, 120]) {
        expect(trigger.shouldTranslate(settled(length), 0)).toBe(true);
        trigger.markStarted(settled(length), 0);
        trigger.markSettled();
      }
    });

    it('survives a correction that shortens the settled text', () => {
      // `markStarted` assigns the baseline rather than accumulating it, so a
      // re-anchor that shortens the line moves the mark down with it instead of
      // leaving one the text can never reach again.
      const { trigger } = makeTrigger({ commitChars: 20 });
      trigger.markStarted(settled(100), 0);
      trigger.markSettled();

      expect(trigger.shouldTranslate(settled(40), 1)).toBe(true);
      trigger.markStarted(settled(40), 1);
      trigger.markSettled();
      expect(trigger.shouldTranslate(settled(80), 1)).toBe(true);
    });
  });

  describe('the clause rule', () => {
    it('is a transition, not a state', () => {
      // Text that already contains a comma is always "closing a clause", so a
      // state check would latch true forever on an English-source pair.
      const { trigger } = makeTrigger({ commitChars: 500 });
      const text = 'yesterday I booked a room, for two nights';

      expect(trigger.shouldTranslate(text, 0)).toBe(true);
      trigger.markStarted(text, 0);
      trigger.markSettled();
      expect(trigger.shouldTranslate(text, 0)).toBe(false);
    });
  });

  describe('the clause rule in Chinese', () => {
    // Chinese ends a clause on a full-width mark with no space after it. A
    // trigger blind to `，。` would never see a Chinese clause close, and zh
    // provisional text would wait for the character rule alone.
    it('sees a full-width comma close a clause, then a full-width question mark', () => {
      const { trigger } = makeTrigger({ commitChars: 500 });

      expect(trigger.shouldTranslate('我们明天开会，', 0)).toBe(true);
      trigger.markStarted('我们明天开会，', 0);
      trigger.markSettled();
      expect(trigger.shouldTranslate('我们明天开会，你来', 0)).toBe(false);
      expect(trigger.shouldTranslate('我们明天开会，你来吗？', 0)).toBe(true);
    });

    it('fires on seven settled Han characters, the zh entry of the tuning table', () => {
      // A Han character is a syllable, so 15 of them is far more speech than 15
      // letters; measured, zh fired at 0.45x the vi rate at 15.
      const { trigger } = makeTrigger({
        commitChars: LIVE_TRANSLATION_COMMIT_CHARS.zh,
      });
      expect(trigger.shouldTranslate('我们明天上午', 0)).toBe(false);
      expect(trigger.shouldTranslate('我们明天上午开', 0)).toBe(true);
      expect(LIVE_TRANSLATION_COMMIT_CHARS.vi).toBe(15);
    });

    it('sees no clause in unpunctuated Chinese', () => {
      const { trigger } = makeTrigger({ commitChars: 500 });
      expect(trigger.shouldTranslate('我们明天开会你来吗', 0)).toBe(false);
    });
  });

  describe('the correction rule', () => {
    it('translates again when settled text was replaced', () => {
      const { trigger } = makeTrigger({ commitChars: 500 });
      trigger.markStarted(settled(30), 0);
      trigger.markSettled();

      expect(trigger.shouldTranslate(settled(30), 1)).toBe(true);
    });

    it('is a transition, not a state', () => {
      const { trigger } = makeTrigger({ commitChars: 500 });
      trigger.markStarted(settled(30), 1);
      trigger.markSettled();

      expect(trigger.shouldTranslate(settled(30), 1)).toBe(false);
    });
  });

  describe('the budget', () => {
    it('refuses once the budget is spent, clause or no clause', () => {
      const { trigger, budget } = makeTrigger({ perUserRpm: 1 });
      budget.spend(USER, MODEL);
      expect(trigger.shouldTranslate('yesterday I booked a room,', 0)).toBe(
        false,
      );
    });

    it('spends exactly one unit per translation started', () => {
      const { trigger, budget } = makeTrigger();
      trigger.markStarted(settled(30), 0);
      expect(budget.spentLastMinute(MODEL)).toBe(1);
    });

    it('refuses while a translation is still in flight', () => {
      const { trigger } = makeTrigger({ commitChars: 10 });
      trigger.markStarted(settled(30), 0);
      expect(trigger.shouldTranslate(settled(90), 0)).toBe(false);
      trigger.markSettled();
      expect(trigger.shouldTranslate(settled(90), 0)).toBe(true);
    });
  });

  describe('bookkeeping', () => {
    it('counts what the turn spent', () => {
      const { trigger } = makeTrigger();
      trigger.markStarted(settled(30), 0);
      trigger.markSettled();
      trigger.markStarted(settled(60), 0);
      expect(trigger.spentCount).toBe(2);
    });
  });
});

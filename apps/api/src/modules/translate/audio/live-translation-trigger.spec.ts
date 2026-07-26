import { LiveTranslationTrigger } from './live-translation-trigger';

function makeTrigger(overrides: Record<string, number> = {}) {
  let clock = 100_000;
  const trigger = new LiveTranslationTrigger({
    now: () => clock,
    ...overrides,
  });
  return {
    trigger,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Text of `n` words, so tests say what they mean about length. */
const words = (n: number): string =>
  Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('LiveTranslationTrigger', () => {
  // The whole reason this gate exists: a short turn's real translation beats a
  // guess, so spending a metered request on one is pure loss.
  it('leaves a short turn alone', () => {
    const { trigger } = makeTrigger({ minSpeechSeconds: 3 });

    expect(trigger.shouldTranslate(words(8), 1.5)).toBe(false);
    expect(trigger.shouldTranslate(words(8), 3)).toBe(true);
  });

  it('says nothing about a turn that has no words yet', () => {
    const { trigger } = makeTrigger();
    expect(trigger.shouldTranslate('   ', 5)).toBe(false);
  });

  it('waits out the interval before translating the same turn again', () => {
    const { trigger, advance } = makeTrigger({ minIntervalMs: 2_500 });
    trigger.markStarted(words(10));
    trigger.markSettled();

    advance(2_499);
    expect(trigger.shouldTranslate(words(14), 6)).toBe(false);
    advance(1);
    expect(trigger.shouldTranslate(words(14), 6)).toBe(true);
  });

  // A negation or a changed object can invert a sentence in a few words, so a
  // fast speaker must not be left looking at a translation their speech has
  // already contradicted.
  it('translates early when enough new words have arrived', () => {
    const { trigger, advance } = makeTrigger({
      minIntervalMs: 2_500,
      wordsForEarlyRefresh: 12,
    });
    trigger.markStarted(words(10));
    trigger.markSettled();
    advance(200);

    expect(trigger.shouldTranslate(words(21), 6)).toBe(false);
    expect(trigger.shouldTranslate(words(22), 6)).toBe(true);
  });

  it('does not spend a request on words it has already translated', () => {
    const { trigger, advance } = makeTrigger();
    trigger.markStarted(words(10));
    trigger.markSettled();
    advance(10_000);

    expect(trigger.shouldTranslate(words(10), 8)).toBe(false);
    expect(trigger.shouldTranslate(words(11), 8)).toBe(true);
  });

  it('never runs two translations of one turn at once', () => {
    const { trigger, advance } = makeTrigger();
    trigger.markStarted(words(10));
    advance(10_000);

    expect(trigger.shouldTranslate(words(40), 12)).toBe(false);
    trigger.markSettled();
    expect(trigger.shouldTranslate(words(40), 12)).toBe(true);
  });

  // The turn keeps working past the cap; it just stops guessing. Without one, a
  // long rambling turn would spend the quota its own ending needs.
  it('stops guessing once the turn has spent its cap', () => {
    const { trigger, advance } = makeTrigger({ maxPerTurn: 3 });

    for (let i = 1; i <= 3; i += 1) {
      expect(trigger.shouldTranslate(words(10 * i), 10)).toBe(true);
      trigger.markStarted(words(10 * i));
      trigger.markSettled();
      advance(5_000);
    }

    expect(trigger.shouldTranslate(words(100), 30)).toBe(false);
    expect(trigger.spentCount).toBe(3);
  });
});

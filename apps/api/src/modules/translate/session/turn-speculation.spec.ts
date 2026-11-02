import { describe, expect, it } from 'vitest';

import type { TranslatedTurnText } from '../services/pipeline-translator.service';
import { TurnSpeculation } from './turn-speculation';
import { MAX_SPECULATIONS_PER_TURN } from './translation-model-policy';

const answer = {
  sourceText: 'xin chào',
  translations: { en: 'hello' },
} as TranslatedTurnText;

/** A guess whose answer the test releases when it chooses. */
const pending = () => {
  let resolve!: (value: TranslatedTurnText) => void;
  let reject!: (err: Error) => void;
  const work = new Promise<TranslatedTurnText>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { work, resolve, reject };
};

describe('TurnSpeculation', () => {
  it('by default renews over grown audio while a guess is in flight, up to the cap', () => {
    const speculation = new TurnSpeculation();
    for (let i = 0; i < MAX_SPECULATIONS_PER_TURN; i += 1) {
      expect(speculation.canRenew(100 * (i + 1))).toBe(true);
      speculation.start(100 * (i + 1), pending().work);
    }
    expect(speculation.canRenew(10_000)).toBe(false);
    expect(speculation.count).toBe(MAX_SPECULATIONS_PER_TURN);
  });

  it('never guesses twice over the same audio', () => {
    const speculation = new TurnSpeculation();
    speculation.start(100, Promise.resolve(answer));
    expect(speculation.canRenew(100)).toBe(false);
  });

  it('honours a smaller cap', () => {
    const speculation = new TurnSpeculation(2);
    speculation.start(100, Promise.resolve(answer));
    speculation.start(200, Promise.resolve(answer));
    expect(speculation.canRenew(300)).toBe(false);
  });

  it('with overlap off, waits for the guess in flight before guessing again', async () => {
    const speculation = new TurnSpeculation(MAX_SPECULATIONS_PER_TURN, false);
    const first = pending();
    speculation.start(100, first.work);

    expect(speculation.canRenew(200)).toBe(false);

    first.resolve(answer);
    await first.work;
    await Promise.resolve();
    expect(speculation.canRenew(200)).toBe(true);
  });

  it('with overlap off, a failed guess also frees the next one', async () => {
    const speculation = new TurnSpeculation(MAX_SPECULATIONS_PER_TURN, false);
    const first = pending();
    speculation.start(100, first.work);

    first.reject(new Error('host down'));
    await first.work.catch(() => undefined);
    await Promise.resolve();
    expect(speculation.canRenew(200)).toBe(true);
  });

  it('only uses the newest guess, and only over the audio it heard', () => {
    const speculation = new TurnSpeculation();
    const work = Promise.resolve(answer);
    speculation.start(100, work);
    expect(speculation.usable(100)).toBe(work);
    expect(speculation.usable(150)).toBeNull();
  });
});

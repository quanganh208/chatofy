import { describe, expect, it, vi } from 'vitest';
import type { LanguageCode } from '@chatofy/types';
import {
  mergeLanguageDeliveries,
  speakEveryLanguage,
} from './multi-language-speech';
import type { ClauseDelivery } from './turn-timeline';

/** A promise and the function that settles it, for driving order by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((done) => setImmediate(done));

describe('speakEveryLanguage', () => {
  it('starts an extra only once the primary has its first audio out', async () => {
    const started: LanguageCode[] = [];
    const primaryDone = deferred<ClauseDelivery>();
    let primaryFirstAudio!: () => void;

    const speaking = speakEveryLanguage({
      primary: 'en',
      extras: ['zh'],
      speakIn: (language, isPrimary, onFirstAudio) => {
        started.push(language);
        if (isPrimary) {
          primaryFirstAudio = onFirstAudio;
          return primaryDone.promise;
        }
        return Promise.resolve({ firstAudioAt: 2, lastAudioAt: 3 });
      },
      onExtraFailed: vi.fn(),
    });

    await settle();
    expect(started).toEqual(['en']);

    primaryFirstAudio();
    await settle();
    expect(started).toEqual(['en', 'zh']);

    primaryDone.resolve({ firstAudioAt: 1, lastAudioAt: 4 });
    await expect(speaking).resolves.toEqual({
      firstAudioAt: 1,
      lastAudioAt: 4,
    });
  });

  it('starts the extras when the primary ends without any audio', async () => {
    const started: LanguageCode[] = [];

    const delivery = await speakEveryLanguage({
      primary: 'en',
      extras: ['zh'],
      speakIn: (language) => {
        started.push(language);
        return Promise.resolve({ stoppedBy: 'engine_busy' });
      },
      onExtraFailed: vi.fn(),
    });

    expect(started).toEqual(['en', 'zh']);
    expect(delivery).toEqual({ stoppedBy: 'engine_busy' });
  });

  it('an extra that throws is logged once and the primary delivery stands', async () => {
    const onExtraFailed = vi.fn();
    const failure = new Error('zh engine down');

    const delivery = await speakEveryLanguage({
      primary: 'en',
      extras: ['zh'],
      speakIn: (_language, isPrimary, onFirstAudio) => {
        if (!isPrimary) return Promise.reject(failure);
        onFirstAudio();
        return Promise.resolve({ firstAudioAt: 1, lastAudioAt: 2 });
      },
      onExtraFailed,
    });

    expect(delivery).toEqual({ firstAudioAt: 1, lastAudioAt: 2 });
    expect(onExtraFailed).toHaveBeenCalledExactlyOnceWith('zh', failure);
  });

  it('a primary that throws still throws, and the extras settle on their own', async () => {
    const onExtraFailed = vi.fn();
    const failure = new Error('en engine down');

    await expect(
      speakEveryLanguage({
        primary: 'en',
        extras: ['zh'],
        speakIn: (_language, isPrimary) =>
          isPrimary
            ? Promise.reject(failure)
            : Promise.reject(new Error('zh down too')),
        onExtraFailed,
      }),
    ).rejects.toBe(failure);

    await settle();
    expect(onExtraFailed).toHaveBeenCalledOnce();
  });
});

describe('mergeLanguageDeliveries', () => {
  const primary: ClauseDelivery = { firstAudioAt: 1, lastAudioAt: 2 };

  it('is the primary delivery whatever an extra failed with', () => {
    expect(
      mergeLanguageDeliveries(primary, [
        { stoppedBy: 'failed' },
        { stoppedBy: 'engine_busy' },
        { stoppedBy: 'unsupported_audio' },
      ]),
    ).toEqual(primary);
  });

  it('is client_gone when the client left during an extra', () => {
    expect(
      mergeLanguageDeliveries(primary, [{ stoppedBy: 'client_gone' }]),
    ).toEqual({ ...primary, stoppedBy: 'client_gone' });
  });
});

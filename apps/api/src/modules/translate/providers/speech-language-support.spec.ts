import { describe, expect, it, vi } from 'vitest';
import { LANGUAGE_CODES, type LanguageCode } from '@chatofy/types';
import type {
  ServedLanguages,
  SttProvider,
  TtsProvider,
} from '@chatofy/ai-providers';
import type { AiProvidersFactory } from './ai-providers.factory';
import {
  admitLanguageMode,
  SpeechLanguageSupport,
  type LanguageModeRequest,
} from './speech-language-support';

/** A served-languages answer naming only registry languages. */
function served(
  known: LanguageCode[],
  unknown: string[] = [],
): ServedLanguages {
  return { known, unknown };
}

/** A minimal trio the service reads through `AiProvidersFactory.makeProviders()`. */
function fakeFactory(
  stt: Partial<SttProvider> = {},
  tts: Partial<TtsProvider> = {},
): AiProvidersFactory {
  return {
    makeProviders: () => ({
      stt: { name: 'fake-stt', transcribe: vi.fn(), ...stt },
      tts: {
        name: 'fake-tts',
        outputMimeType: 'audio/wav',
        synthesize: vi.fn(),
        ...tts,
      },
      translation: {} as never,
    }),
  } as unknown as AiProvidersFactory;
}

describe('SpeechLanguageSupport', () => {
  it('refuses no turn before the first refresh has settled', async () => {
    const support = new SpeechLanguageSupport(fakeFactory());
    // No `onApplicationBootstrap()` call, no await: the very first turn must
    // find nothing known yet, and nothing known must not refuse.
    expect(
      support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: true }),
    ).toBeNull();
  });

  it('refuses TTS for a language the sidecar does not serve, only when voice output is wanted', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(['vi', 'en']) },
        { supportedLanguages: async () => served(['vi']) },
      ),
    );
    support.onApplicationBootstrap();
    await flush();

    expect(
      support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: true }),
    ).toMatch(/en/);
    expect(
      support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: false }),
    ).toBeNull();
  });

  it('asks no engine to speak a turn with nothing to translate into, but still checks its recognition', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(['en']) },
        // Speaks neither language the turns below are heard in.
        { supportedLanguages: async () => served(['zh']) },
      ),
    );
    support.onApplicationBootstrap();
    await flush();

    expect(
      support.refusal({ recognition: 'en', spoken: null, voiceOutput: true }),
    ).toBeNull();
    expect(
      support.refusal({ recognition: 'vi', spoken: null, voiceOutput: true }),
    ).toMatch(/vi/);
  });

  it('refuses recognition for a language the STT sidecar does not serve', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(['en']) },
        { supportedLanguages: async () => served(['vi', 'en']) },
      ),
    );
    support.onApplicationBootstrap();
    await flush();

    expect(
      support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: true }),
    ).toMatch(/vi/);
  });

  it('does not refuse when a probe fails — unknown is not unavailable', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory(
        {
          supportedLanguages: async () =>
            Promise.reject(new Error('ECONNREFUSED')),
        },
        {
          supportedLanguages: async () =>
            Promise.reject(new Error('ECONNREFUSED')),
        },
      ),
    );
    support.onApplicationBootstrap();
    await flush();

    expect(
      support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: true }),
    ).toBeNull();
  });

  it('a backend that cannot be built leaves nothing refused and no rejection unhandled', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const support = new SpeechLanguageSupport({
        makeProviders: () => {
          throw new Error('Provider "stt:local" is not implemented');
        },
      } as unknown as AiProvidersFactory);
      support.onApplicationBootstrap();
      await flush();
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).not.toHaveBeenCalled();
      expect(
        support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: true }),
      ).toBeNull();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('imposes no restriction for a provider with no supportedLanguages at all (cloud)', async () => {
    // Neither fake declares `supportedLanguages`, matching a cloud provider —
    // parity is ⊆, so an unrestricted backend never causes a refusal.
    const support = new SpeechLanguageSupport(fakeFactory());
    support.onApplicationBootstrap();
    await flush();

    expect(
      support.refusal({ recognition: 'vi', spoken: 'en', voiceOutput: true }),
    ).toBeNull();
  });

  it('logs a warning for a registry language no engine reported, once refreshed', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(['en']) },
        { supportedLanguages: async () => served(['en']) },
      ),
    );
    // Access the private logger through its public surface: Nest's Logger
    // writes through its own static transport, so spying on the instance
    // method is the direct way to assert a warning was emitted at all.
    const logger = (
      support as unknown as { logger: { warn: (msg: string) => void } }
    ).logger;
    const warn = vi.spyOn(logger, 'warn');

    support.onApplicationBootstrap();
    await flush();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("STT engine reported for registry language 'vi'"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("TTS engine reported for registry language 'vi'"),
    );
  });

  it('does not repeat the warning on a later refresh when the served set has not changed', async () => {
    // A deployment that deliberately runs without one engine serves the
    // identical set every 60s. Warning again every refresh forever is exactly
    // the noise this behaviour exists to stop.
    //
    // Calls the private `refresh()` directly, fully awaited, rather than
    // going through `onApplicationBootstrap()` + a fixed-tick `flush()`: the
    // method's own `.finally()` is what clears `inFlight` between refreshes,
    // and only awaiting the method itself is guaranteed to wait for it.
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(['en']) },
        { supportedLanguages: async () => served(['en']) },
      ),
    );
    const logger = (
      support as unknown as { logger: { warn: (msg: string) => void } }
    ).logger;
    const warn = vi.spyOn(logger, 'warn');
    const refresh = () =>
      (support as unknown as { refresh: () => Promise<void> }).refresh();

    await refresh();
    expect(warn).toHaveBeenCalled();

    warn.mockClear();
    await refresh();

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns again once the served set actually changes, and stops once the gap closes', async () => {
    let sttServed: LanguageCode[] = ['en'];
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(sttServed) },
        { supportedLanguages: async () => served([...LANGUAGE_CODES]) },
      ),
    );
    const logger = (
      support as unknown as { logger: { warn: (msg: string) => void } }
    ).logger;
    const warn = vi.spyOn(logger, 'warn');
    const refresh = () =>
      (support as unknown as { refresh: () => Promise<void> }).refresh();

    await refresh();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("STT engine reported for registry language 'vi'"),
    );

    // The gap closes: a set that now includes everything is a CHANGE too, and
    // there is nothing left to warn about.
    warn.mockClear();
    sttServed = [...LANGUAGE_CODES];
    await refresh();
    expect(warn).not.toHaveBeenCalled();

    // The gap reopens: a real change back, not a repeat of the first warning.
    warn.mockClear();
    sttServed = ['en'];
    await refresh();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("STT engine reported for registry language 'vi'"),
    );
  });

  it('warns once about a language the registry does not know, not on every refresh', async () => {
    let sttTags: string[] = ['ja'];
    const support = new SpeechLanguageSupport(
      fakeFactory(
        { supportedLanguages: async () => served(['vi', 'en'], sttTags) },
        { supportedLanguages: async () => served(['vi', 'en']) },
      ),
    );
    const logger = (
      support as unknown as { logger: { warn: (msg: string) => void } }
    ).logger;
    const warn = vi.spyOn(logger, 'warn');
    const refresh = () =>
      (support as unknown as { refresh: () => Promise<void> }).refresh();

    await refresh();
    await refresh();
    await refresh();
    expect(unknownTagWarnings(warn)).toEqual([
      "STT engine reported languages the registry does not know: 'ja'",
    ]);

    // A new stray tag is a change worth one more line.
    warn.mockClear();
    sttTags = ['ja', 'ko'];
    await refresh();
    await refresh();
    expect(unknownTagWarnings(warn)).toEqual([
      "STT engine reported languages the registry does not know: 'ja', 'ko'",
    ]);
  });

  it('does not re-warn about an unknown language after a failed probe in between', async () => {
    let up = true;
    const support = new SpeechLanguageSupport(
      fakeFactory(
        {
          supportedLanguages: async () =>
            up
              ? served(['vi', 'en'], ['ja'])
              : Promise.reject(new Error('ECONNREFUSED')),
        },
        { supportedLanguages: async () => served(['vi', 'en']) },
      ),
    );
    const logger = (
      support as unknown as { logger: { warn: (msg: string) => void } }
    ).logger;
    const warn = vi.spyOn(logger, 'warn');
    const refresh = () =>
      (support as unknown as { refresh: () => Promise<void> }).refresh();

    await refresh();
    expect(unknownTagWarnings(warn)).toHaveLength(1);

    warn.mockClear();
    up = false;
    await refresh();
    up = true;
    await refresh();
    expect(unknownTagWarnings(warn)).toEqual([]);
  });
});

/**
 * Only the unknown-tag warnings a spy saw — so these assertions do not depend
 * on how many registry languages a fake engine leaves uncovered.
 */
function unknownTagWarnings(warn: { mock: { calls: unknown[][] } }): string[] {
  return warn.mock.calls
    .map(([message]) => String(message))
    .filter((message) => message.includes('registry does not know'));
}

/** Settles the microtask queue the async refresh chains through. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('SpeechLanguageSupport identifiable languages', () => {
  it('knows nothing about identification before the first refresh has settled', () => {
    const support = new SpeechLanguageSupport(
      fakeFactory({
        supportedLanguages: async () => ({
          ...served(['vi', 'en']),
          identifiable: ['vi', 'en'],
        }),
      }),
    );
    expect(support.identifiable()).toBeNull();
  });

  it('reports what the STT engine said it can identify, once refreshed', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory({
        supportedLanguages: async () => ({
          ...served(['vi', 'en', 'zh']),
          identifiable: ['vi', 'en'],
        }),
      }),
    );
    support.onApplicationBootstrap();
    await flush();
    expect(support.identifiable()).toEqual(['vi', 'en']);
  });

  it('reads an answer with no identifiable field as identifying nothing', async () => {
    const support = new SpeechLanguageSupport(
      fakeFactory({ supportedLanguages: async () => served(['vi', 'en']) }),
    );
    support.onApplicationBootstrap();
    await flush();
    expect(support.identifiable()).toEqual([]);
  });

  it('knows nothing for a failed probe or a provider that cannot say', async () => {
    const failing = new SpeechLanguageSupport(
      fakeFactory({
        supportedLanguages: async () => {
          throw new Error('down');
        },
      }),
    );
    failing.onApplicationBootstrap();
    await flush();
    expect(failing.identifiable()).toBeNull();

    const cloud = new SpeechLanguageSupport(fakeFactory());
    cloud.onApplicationBootstrap();
    await flush();
    expect(cloud.identifiable()).toBeNull();
  });

  it('asks a loading engine again on the next start rather than a minute later', async () => {
    // The sidecar is still loading its models when the API boots: the first
    // probe fails, and the start that follows must not wait out the interval.
    let loaded = false;
    const supportedLanguages = vi.fn(async () => {
      if (!loaded) throw new Error('models not loaded');
      return {
        ...served(['vi', 'en']),
        identifiable: ['vi', 'en'] as LanguageCode[],
      };
    });
    const support = new SpeechLanguageSupport(
      fakeFactory({ supportedLanguages }),
    );
    support.onApplicationBootstrap();
    await flush();
    expect(support.identifiable()).toBeNull();

    loaded = true;
    await flush();
    // Answered from what is known, with the probe it started already back.
    support.identifiable();
    await flush();
    expect(support.identifiable()).toEqual(['vi', 'en']);
  });

  it('does not keep asking a provider that has no probe at all', async () => {
    const factory = fakeFactory();
    const makeProviders = vi.spyOn(factory, 'makeProviders');
    const cloud = new SpeechLanguageSupport(factory);
    cloud.onApplicationBootstrap();
    await flush();
    cloud.identifiable();
    cloud.identifiable();
    await flush();
    expect(makeProviders).toHaveBeenCalledTimes(1);
  });

  it('refreshNow asks again at once, without waiting out the interval', async () => {
    let identifiable: LanguageCode[] = ['vi', 'en'];
    const supportedLanguages = vi.fn(async () => ({
      ...served(['vi', 'en']),
      identifiable,
    }));
    const support = new SpeechLanguageSupport(
      fakeFactory({ supportedLanguages }),
    );
    // Awaited whole, so the second call below is not coalesced into it.
    await support.refreshNow();
    expect(support.identifiable()).toEqual(['vi', 'en']);

    identifiable = [];
    await support.refreshNow();

    expect(supportedLanguages).toHaveBeenCalledTimes(2);
    expect(support.identifiable()).toEqual([]);
  });
});

describe('admitLanguageMode', () => {
  const request = (
    over: Partial<LanguageModeRequest> = {},
  ): LanguageModeRequest => ({
    pair: { source: 'vi', target: 'en' },
    twoWay: false,
    identifiable: ['vi', 'en'],
    servedModes: ['declared', 'two-way', 'detect'],
    ...over,
  });

  describe('a declared pair without twoWay', () => {
    it('runs declared whatever is known about identification', () => {
      for (const identifiable of [['vi', 'en'] as LanguageCode[], [], null]) {
        expect(
          admitLanguageMode(
            request({ identifiable, servedModes: ['declared'] }),
          ),
        ).toEqual({
          admitted: true,
          mode: 'declared',
          pair: { source: 'vi', target: 'en' },
        });
      }
    });
  });

  describe('a declared pair with twoWay', () => {
    it('runs two-way when served and both sides are identifiable', () => {
      expect(admitLanguageMode(request({ twoWay: true }))).toEqual({
        admitted: true,
        mode: 'two-way',
        pair: { source: 'vi', target: 'en' },
      });
    });

    it.each([
      ['identification is not known', { identifiable: null }],
      ['the engine identifies nothing', { identifiable: [] }],
      ['the engine cannot identify one side', { identifiable: ['vi'] }],
      ['this build does not serve two-way', { servedModes: ['declared'] }],
    ] satisfies [string, Partial<LanguageModeRequest>][])(
      'degrades to declared, with a reason, when %s',
      (_case, over) => {
        expect(admitLanguageMode(request({ twoWay: true, ...over }))).toEqual({
          admitted: true,
          mode: 'declared',
          pair: { source: 'vi', target: 'en' },
          modeReason: 'language_detection',
        });
      },
    );

    it('degrades a pair with Chinese even when the engine claims to identify it', () => {
      expect(
        admitLanguageMode(
          request({
            pair: { source: 'zh', target: 'vi' },
            twoWay: true,
            identifiable: ['vi', 'en', 'zh'],
          }),
        ),
      ).toEqual({
        admitted: true,
        mode: 'declared',
        pair: { source: 'zh', target: 'vi' },
        modeReason: 'language_detection',
      });
    });
  });

  describe('an undeclared source', () => {
    it('runs detect when served and identifiable, ignoring twoWay', () => {
      for (const twoWay of [false, true]) {
        expect(
          admitLanguageMode(
            request({ pair: { source: 'detect', target: 'zh' }, twoWay }),
          ),
        ).toEqual({ admitted: true, mode: 'detect', target: 'zh' });
      }
    });

    it.each([
      ['identification is not known', { identifiable: null }],
      ['the engine identifies nothing', { identifiable: [] }],
      ['the engine cannot identify every candidate', { identifiable: ['en'] }],
      [
        'this build does not serve detect',
        { servedModes: ['declared', 'two-way'] },
      ],
    ] satisfies [string, Partial<LanguageModeRequest>][])(
      'is refused with a detail, never degraded, when %s',
      (_case, over) => {
        const admission = admitLanguageMode(
          request({ pair: { source: 'detect', target: 'en' }, ...over }),
        );
        expect(admission).toMatchObject({
          admitted: false,
          detail: 'language_detection',
        });
        expect(admission.admitted === false && admission.message).toMatch(
          /identify/,
        );
      },
    );
  });
});

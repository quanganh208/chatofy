import { describe, expect, it, vi } from 'vitest';
import type { LanguageCode } from '@chatofy/types';
import type {
  ServedLanguages,
  SttProvider,
  TtsProvider,
} from '@chatofy/ai-providers';
import type { AiProvidersFactory } from './ai-providers.factory';
import { SpeechLanguageSupport } from './speech-language-support';

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
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("STT engine reported for registry language 'vi'"),
    );

    // The gap closes: a set that now includes everything is a CHANGE too, and
    // there is nothing left to warn about.
    warn.mockClear();
    sttServed = ['vi', 'en'];
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

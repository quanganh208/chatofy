import { describe, expect, it, vi } from 'vitest';
import type { SttProvider, TtsProvider } from '@chatofy/ai-providers';
import type { AiProvidersFactory } from './ai-providers.factory';
import { SpeechLanguageSupport } from './speech-language-support';

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
        { supportedLanguages: async () => ['vi', 'en'] },
        { supportedLanguages: async () => ['vi'] },
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
        { supportedLanguages: async () => ['en'] },
        { supportedLanguages: async () => ['vi', 'en'] },
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
        { supportedLanguages: async () => ['en'] },
        { supportedLanguages: async () => ['en'] },
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
});

/** Settles the microtask queue the async refresh chains through. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

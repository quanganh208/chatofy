// Verifies the factory memoizes the provider trio per tier so the GoogleGenAI
// client + its connection pool persist across requests (no per-request `new`).
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest
    .fn()
    .mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
}));

import { GoogleGenAI } from '@google/genai';
import {
  ProviderNotImplementedError,
  ProviderRegistry,
  resolveQualityProfile,
  type TtsProvider,
} from '@chatofy/ai-providers';
import type { ConfigService } from '@nestjs/config';
import { AiProvidersFactory } from './ai-providers.factory';
import { registerDefaultProviders } from './register-default-providers';

function makeConfig(
  overrides: Record<string, unknown> = {},
): ConfigService<Record<string, unknown>, true> {
  const map: Record<string, unknown> = {
    AI_STT_PROVIDER: 'elevenlabs',
    AI_TTS_PROVIDER: 'elevenlabs',
    AI_TRANSLATION_PROVIDER: 'gemini',
    ELEVENLABS_API_KEY: 'eleven-key',
    GEMINI_API_KEY: 'gemini-key',
    ELEVENLABS_TTS_VOICE_ID: 'voice-id',
    VIENEU_TTS_URL: 'http://localhost:8001',
    VIENEU_TTS_VOICE: 'Phạm Tuyên',
    LOCAL_STT_URL: 'http://localhost:8002',
    LOCAL_TTS_URL: 'http://localhost:8003',
    LOCAL_TTS_VOICE_ID: '0',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => map[key]),
  } as unknown as ConfigService<Record<string, unknown>, true>;
}

/** Mirror of the module wiring — the registry populated at the composition root. */
function makeFactory(
  overrides: Record<string, unknown> = {},
  registry: ProviderRegistry = registerDefaultProviders(new ProviderRegistry()),
): AiProvidersFactory {
  return new AiProvidersFactory(makeConfig(overrides), registry);
}

describe('AiProvidersFactory (memoization)', () => {
  beforeEach(() => (GoogleGenAI as jest.Mock).mockClear());

  it('reuses the same trio instances for the same tier', () => {
    const factory = makeFactory();
    const a = factory.makeProviders(resolveQualityProfile(0.5));
    const b = factory.makeProviders(resolveQualityProfile(0.5));

    expect(b.stt).toBe(a.stt);
    expect(b.translation).toBe(a.translation);
    expect(b.tts).toBe(a.tts);
  });

  it('builds the GoogleGenAI client once per distinct tier', () => {
    const factory = makeFactory();
    factory.makeProviders(resolveQualityProfile(0.5));
    factory.makeProviders(resolveQualityProfile(0.5));
    factory.makeProviders(resolveQualityProfile(0.5));

    // Three same-tier requests → exactly one client construction.
    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
  });

  it('builds distinct trios for distinct tiers', () => {
    const factory = makeFactory();
    const fast = factory.makeProviders(resolveQualityProfile(0.0));
    const balanced = factory.makeProviders(resolveQualityProfile(0.5));

    expect(balanced.translation).not.toBe(fast.translation);
    expect(GoogleGenAI).toHaveBeenCalledTimes(2);
  });

  it('isolates cache per factory instance', () => {
    const a = makeFactory().makeProviders(resolveQualityProfile(0.5));
    const b = makeFactory().makeProviders(resolveQualityProfile(0.5));
    expect(b.translation).not.toBe(a.translation);
  });

  it('routes the TTS provider by target language', () => {
    const factory = makeFactory();
    const en = factory.makeProviders(resolveQualityProfile(0.5), 'en');
    const vi = factory.makeProviders(resolveQualityProfile(0.5), 'vi');

    expect(en.tts.name).toBe('elevenlabs');
    expect(vi.tts.name).toBe('vieneu');
    // Distinct cache entries per target language — no cross-serving.
    expect(vi.tts).not.toBe(en.tts);
  });

  it('defaults targetLang to English (ElevenLabs) when omitted', () => {
    const factory = makeFactory();
    const def = factory.makeProviders(resolveQualityProfile(0.5));
    const en = factory.makeProviders(resolveQualityProfile(0.5), 'en');
    expect(def.tts.name).toBe('elevenlabs');
    expect(def.tts).toBe(en.tts); // same cache entry
  });

  it('resolves the local sidecars when selected, keeping vi on VieNeu', () => {
    // The whole local-speech integration rests on this: registering a TTS
    // provider named `local` is enough, because the factory routes Vietnamese
    // output to `vieneu` regardless of AI_TTS_PROVIDER.
    const factory = makeFactory({
      AI_STT_PROVIDER: 'local',
      AI_TTS_PROVIDER: 'local',
    });
    const en = factory.makeProviders(resolveQualityProfile(0.5), 'en');
    const vi = factory.makeProviders(resolveQualityProfile(0.5), 'vi');

    expect(en.stt.name).toBe('local');
    expect(en.tts.name).toBe('local');
    expect(vi.stt.name).toBe('local'); // one STT backend serves both languages
    expect(vi.tts.name).toBe('vieneu');
  });

  it('builds the local trio without any ElevenLabs key', () => {
    // Proves the default local path needs no cloud credentials — the
    // ElevenLabs providers throw from their constructors when the key is
    // missing, so this would fail if `local` still resolved through them.
    const factory = makeFactory({
      AI_STT_PROVIDER: 'local',
      AI_TTS_PROVIDER: 'local',
      ELEVENLABS_API_KEY: undefined,
    });
    expect(() =>
      factory.makeProviders(resolveQualityProfile(0.5), 'en'),
    ).not.toThrow();
  });

  it('surfaces an unknown provider selection as ProviderNotImplementedError', () => {
    const factory = makeFactory({ AI_STT_PROVIDER: 'nope' });
    expect(() => factory.makeProviders(resolveQualityProfile(0.5))).toThrow(
      ProviderNotImplementedError,
    );
  });

  it('supports a new backend via registry registration alone (open-closed)', () => {
    // A hypothetical 4th provider: one register() call, zero factory edits.
    const fakeTts: TtsProvider = {
      name: 'fake4th',
      outputMimeType: 'audio/x-fake',
      synthesize: () => Promise.resolve(new Uint8Array()),
    };
    const registry = registerDefaultProviders(new ProviderRegistry());
    registry.register('tts', { name: 'fake4th', create: () => fakeTts });

    const factory = makeFactory({ AI_TTS_PROVIDER: 'fake4th' }, registry);
    const trio = factory.makeProviders(resolveQualityProfile(0.5), 'en');
    expect(trio.tts).toBe(fakeTts);
  });
});

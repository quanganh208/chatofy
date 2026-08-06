// Verifies the factory memoizes the provider trio per backend selection so the
// GoogleGenAI client + its connection pool persist across requests (no
// per-request `new`), and still rebuilds when the selection changes.
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest
    .fn()
    .mockImplementation(() => ({ models: { generateContent: jest.fn() } })),
}));

import { GoogleGenAI } from '@google/genai';
import {
  ProviderNotImplementedError,
  ProviderRegistry,
  type TtsProvider,
} from '@chatofy/ai-providers';
import type { ConfigService } from '@nestjs/config';
import { AiProvidersFactory } from './ai-providers.factory';
import { registerDefaultProviders } from './register-default-providers';

const DEFAULT_ENV: Record<string, unknown> = {
  AI_STT_PROVIDER: 'elevenlabs',
  AI_TTS_PROVIDER: 'elevenlabs',
  AI_TRANSLATION_PROVIDER: 'gemini',
  ELEVENLABS_API_KEY: 'eleven-key',
  GEMINI_API_KEY: 'gemini-key',
  ELEVENLABS_TTS_VOICE_ID: 'voice-id',
  LOCAL_STT_URL: 'http://localhost:8002',
  LOCAL_TTS_URL: 'http://localhost:8003',
};

/** Reads through to the caller's map, so a test can mutate env between calls. */
function configFrom(
  map: Record<string, unknown>,
): ConfigService<Record<string, unknown>, true> {
  return {
    get: jest.fn((key: string) => map[key]),
  } as unknown as ConfigService<Record<string, unknown>, true>;
}

function makeConfig(
  overrides: Record<string, unknown> = {},
): ConfigService<Record<string, unknown>, true> {
  return configFrom({ ...DEFAULT_ENV, ...overrides });
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

  it('reuses the same trio instances across calls', () => {
    const factory = makeFactory();
    const a = factory.makeProviders();
    const b = factory.makeProviders();

    expect(b.stt).toBe(a.stt);
    expect(b.translation).toBe(a.translation);
    expect(b.tts).toBe(a.tts);
  });

  it('builds the GoogleGenAI client once for an unchanged selection', () => {
    const factory = makeFactory();
    factory.makeProviders();
    factory.makeProviders();
    factory.makeProviders();

    // Three requests on one selection → exactly one client construction.
    expect(GoogleGenAI).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the trio when the backend selection changes', () => {
    // The cache is keyed by the selected backend names, so a selection change
    // must not be served from a trio built for the previous one.
    const env = { ...DEFAULT_ENV };
    const factory = new AiProvidersFactory(
      configFrom(env),
      registerDefaultProviders(new ProviderRegistry()),
    );

    expect(factory.makeProviders().tts.name).toBe('elevenlabs');
    env.AI_TTS_PROVIDER = 'local';
    expect(factory.makeProviders().tts.name).toBe('local');
  });

  it('isolates cache per factory instance', () => {
    const a = makeFactory().makeProviders();
    const b = makeFactory().makeProviders();
    expect(b.translation).not.toBe(a.translation);
  });

  it('honours AI_TTS_PROVIDER with no per-language exception', () => {
    // Both output languages resolve the same backend; each provider is told
    // the language per call and picks its own engine.
    const factory = makeFactory();
    expect(factory.makeProviders().tts.name).toBe('elevenlabs');

    const local = makeFactory({ AI_TTS_PROVIDER: 'local' });
    expect(local.makeProviders().tts.name).toBe('local');
  });

  it('resolves the local sidecars for both speech stages when selected', () => {
    const factory = makeFactory({
      AI_STT_PROVIDER: 'local',
      AI_TTS_PROVIDER: 'local',
    });
    const trio = factory.makeProviders();

    expect(trio.stt.name).toBe('local');
    expect(trio.tts.name).toBe('local');
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
    expect(() => factory.makeProviders()).not.toThrow();
  });

  it('surfaces an unknown provider selection as ProviderNotImplementedError', () => {
    const factory = makeFactory({ AI_STT_PROVIDER: 'nope' });
    expect(() => factory.makeProviders()).toThrow(ProviderNotImplementedError);
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
    const trio = factory.makeProviders();
    expect(trio.tts).toBe(fakeTts);
  });

  // Gemini meters quota per project, so a pool of keys from separate projects
  // is what raises the ceiling. The factory only has to hand the pool over
  // intact; what counts as a usable key is the provider's judgement.
  describe('the Gemini key pool', () => {
    /** The apiKey each constructed SDK client was given, in order. */
    const constructedKeys = (): string[] =>
      ((GoogleGenAI as jest.Mock).mock.calls as [{ apiKey: string }][]).map(
        ([config]) => config.apiKey,
      );

    it('splits the comma-separated pool into one client per key', () => {
      makeFactory({ GEMINI_API_KEY: 'k1,k2,k3,k4' }).makeProviders();

      expect(constructedKeys()).toEqual(['k1', 'k2', 'k3', 'k4']);
    });

    it('builds a single client from a single key', () => {
      // The pre-existing form; a deployment that never heard of rotation must
      // keep behaving exactly as it did.
      makeFactory().makeProviders();

      expect(constructedKeys()).toEqual(['gemini-key']);
    });
  });
});

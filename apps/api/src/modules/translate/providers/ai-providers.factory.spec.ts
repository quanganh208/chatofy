import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
// Verifies the factory memoizes the provider trio per backend selection so the
// GoogleGenAI client + its connection pool persist across requests (no
// per-request `new`), and still rebuilds when the selection changes.
// A function expression rather than an arrow: the factory reaches this through
// `new GoogleGenAI(...)`, and an arrow cannot be constructed.
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: vi.fn() } };
  }),
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
    get: vi.fn((key: string) => map[key]),
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
  beforeEach(() => (GoogleGenAI as Mock).mockClear());

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
      ((GoogleGenAI as Mock).mock.calls as [{ apiKey: string }][]).map(
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
  // What each OpenAI-compatible host is worth is decided by three constants that
  // no environment variable carries: the base URL, the flag that turns off a
  // reasoning pass the host enables by default, and which field name the host
  // will accept for the output ceiling. Wrong values do not look wrong — the
  // translator keeps working, just slower than the recorded numbers or failing
  // every turn — so the table that holds them is asserted here rather than
  // trusted.
  describe('the OpenAI-compatible host table', () => {
    const REAL_FETCH = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = REAL_FETCH;
    });

    /** The request body one translation through `name` actually puts on the wire. */
    async function bodySentBy(
      name: string,
      env: Record<string, unknown>,
    ): Promise<{ url: string; body: Record<string, unknown> }> {
      let sent: { url: string; body: Record<string, unknown> } | undefined;
      globalThis.fetch = vi.fn(async (url: unknown, request: unknown) => {
        const { body } = request as { body: string };
        sent = {
          url: String(url),
          body: JSON.parse(body) as Record<string, unknown>,
        };
        const encoder = new TextEncoder();
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n`,
                ),
              );
              controller.close();
            },
          }),
          text: async () => '',
        } as unknown as Response;
      });

      const factory = makeFactory({
        ...env,
        AI_TRANSLATION_PROVIDER: name,
      });
      await factory.makeProviders().translation.translate({
        text: 'xin chào',
        sourceLanguage: 'vi',
        targetLanguage: 'en',
      });
      if (!sent) throw new Error(`${name} sent no request`);
      return sent;
    }

    it('reaches DeepSeek with thinking switched off', async () => {
      const sent = await bodySentBy('deepseek', {
        OPENAI_COMPATIBLE_API_KEY: 'ds-key',
      });

      expect(sent.url).toBe('https://api.deepseek.com/chat/completions');
      expect(sent.body.model).toBe('deepseek-flash');
      expect(sent.body.thinking).toEqual({ type: 'disabled' });
      expect(sent.body.max_tokens).toBe(512);
    });

    it('reaches OpenAI with the ceiling field that line accepts', async () => {
      const sent = await bodySentBy('openai', {
        OPENAI_COMPATIBLE_API_KEY: 'oa-key',
      });

      expect(sent.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(sent.body.model).toBe('gpt-5-nano');
      expect(sent.body.reasoning_effort).toBe('minimal');
      // The point of the whole option: this line answers 400 on `max_tokens`,
      // so the older name must be absent rather than merely accompanied.
      expect(sent.body.max_completion_tokens).toBe(512);
      expect(sent.body).not.toHaveProperty('max_tokens');
    });

    it("takes each host's endpoint and model from the same row", async () => {
      // The pairing is the invariant. One key selects a host and the host
      // brings both halves, so no setting can send one host's model id to
      // another host's endpoint — a combination that used to be expressible and
      // answered 400 on every turn.
      const deepseek = await bodySentBy('deepseek', {
        OPENAI_COMPATIBLE_API_KEY: 'shared-key',
      });
      const openai = await bodySentBy('openai', {
        OPENAI_COMPATIBLE_API_KEY: 'shared-key',
      });

      expect(deepseek.url).toContain('api.deepseek.com');
      expect(deepseek.body.model).toBe('deepseek-flash');
      expect(openai.url).toContain('api.openai.com');
      expect(openai.body.model).toBe('gpt-5-nano');
    });
  });
});

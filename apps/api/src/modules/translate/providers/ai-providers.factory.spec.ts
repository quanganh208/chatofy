import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
// Verifies the factory memoizes the provider trio per translation selection so
// the GoogleGenAI client + its connection pool persist across requests (no
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
  type TranslationProvider,
  type TtsProvider,
} from '@chatofy/ai-providers';
import type { ConfigService } from '@nestjs/config';
import { AiProvidersFactory } from './ai-providers.factory';
import { registerDefaultProviders } from './register-default-providers';

const DEFAULT_ENV: Record<string, unknown> = {
  AI_TRANSLATION_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'gemini-key',
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

  it('rebuilds the trio when the translation selection changes', () => {
    // The cache is keyed by the selected translation host, so a selection
    // change must not be served from a trio built for the previous one.
    const env: Record<string, unknown> = {
      ...DEFAULT_ENV,
      OPENAI_COMPATIBLE_API_KEY: 'deepseek-key',
    };
    const factory = new AiProvidersFactory(
      configFrom(env),
      registerDefaultProviders(new ProviderRegistry()),
    );

    const before = factory.makeProviders().translation;
    env.AI_TRANSLATION_PROVIDER = 'deepseek';
    expect(factory.makeProviders().translation).not.toBe(before);
  });

  it('isolates cache per factory instance', () => {
    const a = makeFactory().makeProviders();
    const b = makeFactory().makeProviders();
    expect(b.translation).not.toBe(a.translation);
  });

  it('always resolves the self-hosted sidecars for both speech stages', () => {
    // Speech is never selectable: a leftover selector in the environment is
    // not read, and no cloud speech credential is needed to build the trio.
    const factory = makeFactory({
      AI_STT_PROVIDER: 'cloud',
      AI_TTS_PROVIDER: 'cloud',
    });
    const trio = factory.makeProviders();

    expect(trio.stt.name).toBe('local');
    expect(trio.tts.name).toBe('local');
  });

  it('fails loudly when a second speech backend is registered', () => {
    // `resolveOnly` refuses to pick between two: adding one is the moment to
    // decide how a caller chooses, not a silent first-wins.
    const fakeTts: TtsProvider = {
      name: 'fake4th',
      outputMimeType: 'audio/x-fake',
      synthesize: () => Promise.resolve(new Uint8Array()),
    };
    const registry = registerDefaultProviders(new ProviderRegistry());
    registry.register('tts', { name: 'fake4th', create: () => fakeTts });

    expect(() => makeFactory({}, registry).makeProviders()).toThrow(
      ProviderNotImplementedError,
    );
  });

  it('surfaces an unknown translation selection as ProviderNotImplementedError', () => {
    const factory = makeFactory({ AI_TRANSLATION_PROVIDER: 'nope' });
    expect(() => factory.makeProviders()).toThrow(ProviderNotImplementedError);
  });

  it('supports a new translation host via registry registration alone (open-closed)', () => {
    // A hypothetical extra host: one register() call, zero factory edits.
    const fakeTranslation: TranslationProvider = {
      name: 'fake4th',
      translate: () => Promise.reject(new Error('unused')),
    };
    const registry = registerDefaultProviders(new ProviderRegistry());
    registry.register('translation', {
      name: 'fake4th',
      create: () => fakeTranslation,
    });

    const factory = makeFactory(
      { AI_TRANSLATION_PROVIDER: 'fake4th' },
      registry,
    );
    expect(factory.makeProviders().translation).toBe(fakeTranslation);
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

    it('reaches Command Code first on the fast model, with no reasoning flag', async () => {
      const sent = await bodySentBy('commandcode', {
        COMMAND_CODE_API_KEY: 'cc-key',
        OPENAI_COMPATIBLE_API_KEY: 'ds-key',
      });

      expect(sent.url).toBe(
        'https://api.commandcode.ai/provider/v1/chat/completions',
      );
      expect(sent.body.model).toBe('deepseek/deepseek-v4-flash-fast');
      // The host answers 400 to `reasoning_effort` on this model.
      expect(sent.body).not.toHaveProperty('reasoning_effort');
      expect(sent.body).not.toHaveProperty('thinking');
    });

    it('falls back to the DeepSeek row when Command Code refuses', async () => {
      const urls: string[] = [];
      const encoder = new TextEncoder();
      globalThis.fetch = vi.fn(async (url: unknown) => {
        urls.push(String(url));
        if (String(url).includes('commandcode')) {
          return {
            ok: false,
            status: 429,
            text: async () =>
              '{"error":{"message":"You\'ve reached your 5-hour usage limit","code":"RATE_LIMITED"}}',
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}\n`,
                ),
              );
              controller.close();
            },
          }),
          text: async () => '',
        } as unknown as Response;
      });

      const factory = makeFactory({
        AI_TRANSLATION_PROVIDER: 'commandcode',
        COMMAND_CODE_API_KEY: 'cc-key',
        OPENAI_COMPATIBLE_API_KEY: 'ds-key',
      });
      const result = await factory.makeProviders().translation.translate({
        text: 'xin chào',
        sourceLanguage: 'vi',
        targetLanguage: 'en',
      });

      expect(result.text).toBe('hello');
      expect(urls).toEqual([
        'https://api.commandcode.ai/provider/v1/chat/completions',
        'https://api.deepseek.com/chat/completions',
      ]);
    });
  });

  describe('the translation polisher', () => {
    it('exists only on the commandcode selection', () => {
      expect(
        makeFactory({
          AI_TRANSLATION_PROVIDER: 'deepseek',
        }).makeTranslationPolisher(),
      ).toBeNull();
      expect(
        makeFactory({
          AI_TRANSLATION_PROVIDER: 'gemini',
        }).makeTranslationPolisher(),
      ).toBeNull();
      const polisher = makeFactory({
        AI_TRANSLATION_PROVIDER: 'commandcode',
        COMMAND_CODE_API_KEY: 'cc-key',
      }).makeTranslationPolisher();
      expect(polisher?.name).toBe('commandcode-polish');
    });

    it('keeps translation on Command Code and polishes on DeepSeek when only the polish model is refused', async () => {
      const REAL_FETCH = globalThis.fetch;
      try {
        const urls: string[] = [];
        globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
          urls.push(String(url));
          const model = (
            JSON.parse((init as { body: string }).body) as { model: string }
          ).model;
          if (model === 'gpt-5.6-sol') {
            return {
              ok: false,
              status: 403,
              text: async () => 'MODEL_NOT_IN_PLAN',
            } as unknown as Response;
          }
          return {
            ok: true,
            status: 200,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n`,
                  ),
                );
                controller.close();
              },
            }),
            text: async () => '',
            // The polisher reads one JSON answer rather than a stream.
            json: async () => ({
              choices: [{ message: { content: 'hello' } }],
            }),
          } as unknown as Response;
        });
        const factory = makeFactory({
          AI_TRANSLATION_PROVIDER: 'commandcode',
          COMMAND_CODE_API_KEY: 'cc-key',
          OPENAI_COMPATIBLE_API_KEY: 'ds-key',
        });
        const polish = () =>
          factory.makeTranslationPolisher()!.polish({
            source: 'xin chào',
            draft: 'hi',
            sourceLanguage: 'vi',
            targetLanguage: 'en',
          });

        await expect(polish()).rejects.toMatchObject({ status: 403 });
        // Moved locally: the next polish goes to DeepSeek, not the refused model.
        await polish();
        await factory.makeProviders().translation.translate({
          text: 'xin chào',
          sourceLanguage: 'vi',
          targetLanguage: 'en',
        });
        expect(urls.filter((u) => u.includes('commandcode'))).toHaveLength(2);
        expect(urls.filter((u) => u.includes('deepseek.com'))).toHaveLength(1);
      } finally {
        globalThis.fetch = REAL_FETCH;
      }
    });

    it('lets the draft stand while the host is out when there is no DeepSeek key', async () => {
      const REAL_FETCH = globalThis.fetch;
      try {
        globalThis.fetch = vi.fn(
          async () =>
            ({
              ok: false,
              status: 429,
              text: async () => 'usage limit RATE_LIMITED',
            }) as unknown as Response,
        );
        const polisher = makeFactory({
          AI_TRANSLATION_PROVIDER: 'commandcode',
          COMMAND_CODE_API_KEY: 'cc-key',
        }).makeTranslationPolisher()!;
        const polish = () =>
          polisher.polish({
            source: 'xin chào',
            draft: 'hi',
            sourceLanguage: 'vi',
            targetLanguage: 'en',
          });

        await expect(polish()).rejects.toMatchObject({ status: 429 });
        await expect(polish()).resolves.toBeNull();
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = REAL_FETCH;
      }
    });

    it('polishes on DeepSeek, never Command Code, while the host is out', async () => {
      const REAL_FETCH = globalThis.fetch;
      try {
        // A spent window seen by the TRANSLATOR must stop the polisher too:
        // the circuit is one per registry, shared by every Command Code caller.
        globalThis.fetch = vi.fn(async (url: unknown) =>
          String(url).includes('commandcode')
            ? ({
                ok: false,
                status: 429,
                text: async () => 'usage limit RATE_LIMITED',
              } as unknown as Response)
            : ({
                ok: true,
                status: 200,
                body: new ReadableStream({
                  start(controller) {
                    controller.enqueue(
                      new TextEncoder().encode(
                        `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n`,
                      ),
                    );
                    controller.close();
                  },
                }),
                text: async () => '',
                json: async () => ({
                  choices: [{ message: { content: 'hello' } }],
                }),
              } as unknown as Response),
        );
        const factory = makeFactory({
          AI_TRANSLATION_PROVIDER: 'commandcode',
          COMMAND_CODE_API_KEY: 'cc-key',
          OPENAI_COMPATIBLE_API_KEY: 'ds-key',
        });
        await factory.makeProviders().translation.translate({
          text: 'xin chào',
          sourceLanguage: 'vi',
          targetLanguage: 'en',
        });
        const calls = vi.mocked(globalThis.fetch).mock.calls.length;

        await factory.makeTranslationPolisher()!.polish({
          source: 'xin chào',
          draft: 'hi',
          sourceLanguage: 'vi',
          targetLanguage: 'en',
        });
        const after = vi.mocked(globalThis.fetch).mock.calls.slice(calls);
        expect(after).toHaveLength(1);
        const [url, init] = after[0] as [unknown, { body: string }];
        expect(String(url)).toContain('api.deepseek.com');
        expect(JSON.parse(init.body)).toMatchObject({
          model: 'deepseek-v4-pro',
          thinking: { type: 'disabled' },
        });
      } finally {
        globalThis.fetch = REAL_FETCH;
      }
    });
  });
});

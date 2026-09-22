import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderConfigError, ProviderResponseError } from '../../errors/provider-errors.js';
import { OpenAiCompatibleTranslationProvider } from './openai-compatible-translation-provider.js';

/**
 * What this provider puts on the wire, and what it believes coming back.
 *
 * The prompt itself is NOT asserted here beyond the two properties that make it
 * the shipped one — the instruction reaches `system`, and the transcript
 * reaches `user` inside its wrapper. `benchmarks/prompt-injection` is what
 * proves how a model answers it; a unit test can only prove the shape.
 */

const REAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  vi.restoreAllMocks();
});

/** A streamed chat-completions body, as the host would send it. */
const sse = (...lines: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
};

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

/** Captures the request while answering with the given stream. */
const answering = (
  stream: ReadableStream<Uint8Array>,
  init?: { ok?: boolean; status?: number },
) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, request: unknown) => {
    const { body } = request as { body: string };
    calls.push({ url: String(url), body: JSON.parse(body) as Record<string, unknown> });
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      body: stream,
      text: async () => 'upstream said no',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
};

/**
 * The element at `index`, or a failure naming what was missing.
 *
 * `noUncheckedIndexedAccess` is on, and the alternative — optional chaining at
 * every assertion — turns "the request was never made" into an expectation
 * comparing `undefined` with `undefined`, which passes.
 */
const at = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) throw new Error(`expected an item at ${index}, got ${items.length}`);
  return item;
};

const provider = (overrides: Record<string, unknown> = {}) =>
  new OpenAiCompatibleTranslationProvider({
    apiKey: 'k',
    baseUrl: 'https://api.example.com',
    models: ['fast-1'],
    name: 'example',
    ...overrides,
  });

const request = {
  text: 'tôi muốn đặt một bàn',
  sourceLanguage: 'vi' as const,
  targetLanguage: 'en' as const,
};

describe('OpenAiCompatibleTranslationProvider', () => {
  it('sends the shipped instruction as the system turn and the wrapped transcript as the user turn', async () => {
    const calls = answering(sse(delta('I want to book a table'), 'data: [DONE]\n'));

    await expect(provider().translate(request)).resolves.toEqual({
      text: 'I want to book a table',
      model: 'fast-1',
    });

    expect(at(calls, 0).url).toBe('https://api.example.com/chat/completions');
    const messages = at(calls, 0).body.messages as { role: string; content: string }[];
    expect(at(messages, 0).role).toBe('system');
    expect(at(messages, 0).content).toContain('You are a translation engine');
    expect(at(messages, 1).role).toBe('user');
    expect(at(messages, 1).content).toContain('<transcript>tôi muốn đặt một bàn</transcript>');
  });

  it('puts the reminder last in the user turn, after the transcript', async () => {
    const calls = answering(sse(delta('ok'), 'data: [DONE]\n'));

    await provider().translate(request);

    const messages = at(calls, 0).body.messages as { content: string }[];
    const content = at(messages, 1).content;
    // The position is the point: a model weighs the end of a turn most, and
    // that slot belongs to the instruction that the transcript is data.
    expect(content.indexOf('</transcript>')).toBeLessThan(
      content.indexOf('Translate the transcript'),
    );
  });

  it('merges vendor flags into the body without letting them replace the fields it needs', async () => {
    const calls = answering(sse(delta('ok'), 'data: [DONE]\n'));

    await provider({
      extraBody: { thinking: { type: 'disabled' }, model: 'ignored', stream: false },
    }).translate(request);

    expect(at(calls, 0).body.thinking).toEqual({ type: 'disabled' });
    expect(at(calls, 0).body.model).toBe('fast-1');
    expect(at(calls, 0).body.stream).toBe(true);
  });

  it('names the output ceiling `max_tokens` unless told otherwise', async () => {
    const calls = answering(sse(delta('ok'), 'data: [DONE]\n'));

    await provider().translate(request);

    expect(at(calls, 0).body.max_tokens).toBe(512);
    expect(at(calls, 0).body).not.toHaveProperty('max_completion_tokens');
  });

  it('sends only the chosen ceiling field, never both', async () => {
    // The whole point of the option. A host that wants the newer name REJECTS
    // the older one — OpenAI answers 400 "Unsupported parameter: 'max_tokens'" —
    // so a body carrying both would fail exactly where one name was meant to fix
    // it, and asserting the absence is what catches that.
    const calls = answering(sse(delta('ok'), 'data: [DONE]\n'));

    await provider({
      maxOutputTokensField: 'max_completion_tokens',
      maxOutputTokens: 256,
    }).translate(request);

    expect(at(calls, 0).body.max_completion_tokens).toBe(256);
    expect(at(calls, 0).body).not.toHaveProperty('max_tokens');
  });

  it('joins deltas split across chunk boundaries', async () => {
    // One SSE line arriving in two reads is the ordinary case on a slow link,
    // and parsing the halves separately would drop both.
    const half = delta('half a sentence');
    answering(sse(half.slice(0, 20), half.slice(20), 'data: [DONE]\n'));

    await expect(provider().translate(request)).resolves.toMatchObject({
      text: 'half a sentence',
    });
  });

  it('skips a line it cannot parse rather than losing the translation around it', async () => {
    answering(sse(delta('kept'), 'data: {not json\n', ': keep-alive\n', 'data: [DONE]\n'));

    await expect(provider().translate(request)).resolves.toMatchObject({ text: 'kept' });
  });

  it('forwards text as it arrives, marking the first emission a restart', async () => {
    answering(sse(delta('I want '), delta('a table'), 'data: [DONE]\n'));
    const seen: { delta: string; restart: boolean }[] = [];

    await provider().translate({
      ...request,
      onChunk: (text, restart) => seen.push({ delta: text, restart }),
    });

    expect(at(seen, 0)).toEqual({ delta: 'I want ', restart: true });
    expect(at(seen, 1)).toEqual({ delta: 'a table', restart: false });
  });

  it('rejects a body that is empty once the wrapper tag is stripped', async () => {
    // A model that answers with nothing but the wrapper has said nothing, and
    // it must fail here rather than reach speech synthesis as a blank turn.
    answering(sse(delta('<transcript></transcript>'), 'data: [DONE]\n'));

    await expect(provider().translate(request)).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('walks to the next model on a rate limit and reports the one that answered', async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          body: sse(),
          text: async () => 'slow down',
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        body: sse(delta('second model'), 'data: [DONE]\n'),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(provider({ models: ['fast-1', 'fast-2'] }).translate(request)).resolves.toEqual({
      text: 'second model',
      model: 'fast-2',
    });
  });

  it('stops the walk on a rejected key instead of spending the rest of the ladder', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 401,
          body: sse(),
          text: async () => 'bad key',
        }) as unknown as Response,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      provider({ models: ['fast-1', 'fast-2', 'fast-3'] }).translate(request),
    ).rejects.toBeInstanceOf(ProviderResponseError);
    // A credential failure reproduces identically on every entry, so paying a
    // round-trip per model only delays the same answer.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a requested ladder naming models this host does not serve', async () => {
    // The live path pins Gemini ids in `translation-model-policy.ts` and passes
    // them down. Sent on verbatim they drew a 400 from DeepSeek on every turn.
    const calls = answering(sse(delta('answered anyway'), 'data: [DONE]\n'));

    await provider({ models: ['fast-1'] }).translate({
      ...request,
      models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    });

    expect(at(calls, 0).body.model).toBe('fast-1');
  });

  it('still honours a requested ladder where it overlaps what this host serves', async () => {
    const calls = answering(sse(delta('ok'), 'data: [DONE]\n'));

    await provider({ models: ['fast-1', 'fast-2'] }).translate({
      ...request,
      // A caller that knows this host asked for the second model first; that
      // intent survives, because discarding it would flatten a real ladder.
      models: ['fast-2', 'somebody-elses-model'],
    });

    expect(at(calls, 0).body.model).toBe('fast-2');
  });

  it('refuses a configuration it cannot address', () => {
    expect(() => provider({ apiKey: '  ' })).toThrow(ProviderConfigError);
    expect(() => provider({ baseUrl: '' })).toThrow(ProviderConfigError);
    expect(() => provider({ models: [] })).toThrow(ProviderConfigError);
  });

  it('accepts a base URL with a trailing slash or a version segment', () => {
    const calls = answering(sse(delta('ok'), 'data: [DONE]\n'));
    return provider({ baseUrl: 'https://api.example.com/v1/' })
      .translate(request)
      .then(() => {
        expect(at(calls, 0).url).toBe('https://api.example.com/v1/chat/completions');
      });
  });
});

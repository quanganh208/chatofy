import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import type { LlmCallEvent } from '../../interfaces/llm-call-event.js';
import { OpenAiCompatibleSummarizationProvider } from './openai-compatible-summarization-provider.js';

/**
 * The wire shape and how an answer is read. How well a model writes minutes is
 * the minutes bench's to say, and whether it can be talked to is
 * `benchmarks/minutes-injection`'s.
 */
const provider = () =>
  new OpenAiCompatibleSummarizationProvider({
    apiKey: 'k',
    baseUrl: 'https://host.example/v1/',
    model: 'google/gemini-3.7-flash',
    name: 'commandcode-minutes',
  });

const MINUTES = {
  summary: 'They agreed to ship on Friday.',
  keyPoints: ['The release is ready'],
  decisions: ['Ship on Friday'],
  actionItems: [{ description: 'Tag the release', owner: 'An', dueDate: null }],
};

function answer(content: string, status = 200) {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status })
      : new Response(content, { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const request = { transcript: 'An: ship it friday\nBinh: ok', language: 'en' as const };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAiCompatibleSummarizationProvider', () => {
  it('requires a key, a base URL and a model', () => {
    expect(() => new OpenAiCompatibleSummarizationProvider({ baseUrl: 'x', model: 'm' })).toThrow(
      ProviderConfigError,
    );
    expect(() => new OpenAiCompatibleSummarizationProvider({ apiKey: 'k', model: 'm' })).toThrow(
      ProviderConfigError,
    );
  });

  it('asks for one JSON document with the shipped prompt, fenced', async () => {
    const fetchMock = answer(JSON.stringify(MINUTES));
    await provider().summarize(request);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://host.example/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'google/gemini-3.7-flash',
      stream: false,
      response_format: { type: 'json_object' },
    });
    expect(body.messages[0].role).toBe('system');
    const user: string = body.messages[1].content;
    expect(user).toContain('<transcript>');
    expect(user).toContain('An: ship it friday');
  });

  it('reads the answer into a draft carrying the model', async () => {
    answer(JSON.stringify(MINUTES));
    await expect(provider().summarize(request)).resolves.toEqual({
      ...MINUTES,
      model: 'google/gemini-3.7-flash',
    });
  });

  it('reads an answer wrapped in one fenced block', async () => {
    answer('```json\n' + JSON.stringify(MINUTES) + '\n```');
    await expect(provider().summarize(request)).resolves.toMatchObject({
      summary: MINUTES.summary,
    });
  });

  it('refuses an answer that is not a minutes object', async () => {
    answer('Here are the minutes: they shipped.');
    await expect(provider().summarize(request)).rejects.toBeInstanceOf(ProviderResponseError);
    answer('[]');
    await expect(provider().summarize(request)).rejects.toBeInstanceOf(ProviderResponseError);
    answer('   ');
    await expect(provider().summarize(request)).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('throws the host status on a refusal', async () => {
    answer('{"error":{"message":"usage limit","code":"RATE_LIMITED"}}', 429);
    await expect(provider().summarize(request)).rejects.toMatchObject({ status: 429 });
    answer('unauthorized', 401);
    await expect(provider().summarize(request)).rejects.toMatchObject({ status: 401 });
  });

  it('throws a connection error when the host cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(provider().summarize(request)).rejects.toBeInstanceOf(ProviderConnectionError);
  });

  it('asks for a title in the requested language and reads it back', async () => {
    const fetchMock = answer(JSON.stringify({ title: 'Hợp đồng thuê nhà' }));
    await expect(provider().title({ transcript: 'An: thuê nhà', language: 'vi' })).resolves.toBe(
      'Hợp đồng thuê nhà',
    );
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(init.body)) as {
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]!.content).toContain('Write the title in Vietnamese');
    expect(body.messages[1]!.content).toContain('<transcript>');
    expect(body.max_tokens).toBeLessThan(1_000);
  });

  describe('reporting each call', () => {
    const reporting = (events: LlmCallEvent[]) =>
      new OpenAiCompatibleSummarizationProvider({
        apiKey: 'k',
        baseUrl: 'https://host.example/v1',
        model: 'google/gemini-3.7-flash',
        name: 'commandcode-minutes',
        onCall: (event) => events.push(event),
      });

    function answerWithUsage(content: string, usage: unknown) {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
              status: 200,
            }),
        ),
      );
    }

    it('emits one minutes event per pass with the host token counts', async () => {
      const events: LlmCallEvent[] = [];
      answerWithUsage(JSON.stringify(MINUTES), {
        prompt_tokens: 1200,
        completion_tokens: 240,
        prompt_tokens_details: { cached_tokens: 1024 },
      });
      await reporting(events).summarize(request);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: 'minutes',
        host: 'commandcode-minutes',
        model: 'google/gemini-3.7-flash',
        ok: true,
        inputTokens: 1200,
        outputTokens: 240,
        cachedInputTokens: 1024,
      });
      expect(events[0]!.promptHash).toMatch(/^[0-9a-f]{8}$/);
      expect(events[0]!.purpose).toBeUndefined();
    });

    it('emits a title event', async () => {
      const events: LlmCallEvent[] = [];
      answerWithUsage(JSON.stringify({ title: 'Rent' }), {
        prompt_tokens: 300,
        completion_tokens: 9,
      });
      await reporting(events).title({ transcript: 'An: rent', language: 'en' });
      expect(events).toEqual([
        expect.objectContaining({ kind: 'title', ok: true, inputTokens: 300, outputTokens: 9 }),
      ]);
    });

    it('leaves the token fields undefined when the host sends no usage', async () => {
      const events: LlmCallEvent[] = [];
      answerWithUsage(JSON.stringify(MINUTES), undefined);
      await reporting(events).summarize(request);
      expect(events).toHaveLength(1);
      expect(events[0]!.inputTokens).toBeUndefined();
      expect(events[0]!.outputTokens).toBeUndefined();
      expect(events[0]!.cachedInputTokens).toBeUndefined();
    });

    it('emits a failed event on a refusal and on an unreachable host', async () => {
      const events: LlmCallEvent[] = [];
      answer('busy', 503);
      await expect(reporting(events).summarize(request)).rejects.toMatchObject({ status: 503 });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      await expect(reporting(events).summarize(request)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(events.map((e) => [e.kind, e.ok])).toEqual([
        ['minutes', false],
        ['minutes', false],
      ]);
    });

    it('never fails the pass when the listener throws', async () => {
      answer(JSON.stringify(MINUTES));
      const broken = new OpenAiCompatibleSummarizationProvider({
        apiKey: 'k',
        baseUrl: 'https://host.example/v1',
        model: 'm',
        onCall: () => {
          throw new Error('sink down');
        },
      });
      await expect(broken.summarize(request)).resolves.toMatchObject({ summary: MINUTES.summary });
    });
  });
});

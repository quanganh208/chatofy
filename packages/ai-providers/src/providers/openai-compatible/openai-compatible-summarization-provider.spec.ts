import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
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
});

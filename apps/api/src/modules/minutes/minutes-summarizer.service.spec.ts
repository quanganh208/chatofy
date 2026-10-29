import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// `mock`-prefixed so vitest's hoisted factory may reference it.
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  // A function expression: the provider reaches this through `new GoogleGenAI`.
  GoogleGenAI: vi.fn(function () {
    return {
      models: {
        generateContent: (params: unknown): unknown =>
          mockGenerateContent(params) as unknown,
      },
    };
  }),
}));

import type { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '@chatofy/ai-providers';
import type { Env } from '../../config/env.schema';
import { registerDefaultProviders } from '../translate/providers/register-default-providers';
import { MinutesSummarizer } from './minutes-summarizer.service';

/**
 * Which host writes the minutes, through the real registration: the selection
 * that moves translation to Command Code moves minutes with it, Gemini stays
 * behind it, and every other selection is untouched.
 */
const MINUTES = {
  summary: 'They agreed.',
  keyPoints: [],
  decisions: [],
  actionItems: [],
};
const USAGE_LIMIT_BODY =
  '{"error":{"message":"You\'ve reached your 5-hour usage limit","code":"RATE_LIMITED"}}';

function summarizer(env: Partial<Record<keyof Env, string>>) {
  const config = {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
  return new MinutesSummarizer(
    config,
    registerDefaultProviders(new ProviderRegistry()),
  ).get();
}

function stubCommandCode(answer: () => Response) {
  const fetchMock = vi.fn(async (url: string) => {
    if (!url.startsWith('https://api.commandcode.ai/')) {
      throw new Error(`unexpected request to ${url}`);
    }
    return answer();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const request = {
  transcript: 'An: ship friday\nBinh: ok',
  language: 'en' as const,
};

beforeEach(() => {
  mockGenerateContent.mockReset();
  mockGenerateContent.mockResolvedValue({ text: JSON.stringify(MINUTES) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MinutesSummarizer', () => {
  it('sends minutes to Command Code gemini-3.7-flash under commandcode', async () => {
    const fetchMock = stubCommandCode(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(MINUTES) } }],
          }),
          {
            status: 200,
          },
        ),
    );
    const draft = await summarizer({
      AI_TRANSLATION_PROVIDER: 'commandcode',
      COMMAND_CODE_API_KEY: 'cc',
      GEMINI_API_KEY: 'g',
    }).summarize(request);

    expect(draft.model).toBe('google/gemini-3.7-flash');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.commandcode.ai/provider/v1/chat/completions');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'google/gemini-3.7-flash',
      response_format: { type: 'json_object' },
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('lets Gemini answer when Command Code has spent its window, then skips it', async () => {
    const fetchMock = stubCommandCode(
      () => new Response(USAGE_LIMIT_BODY, { status: 429 }),
    );
    const minutes = summarizer({
      AI_TRANSLATION_PROVIDER: 'commandcode',
      COMMAND_CODE_API_KEY: 'cc',
      GEMINI_API_KEY: 'g',
    });

    await expect(minutes.summarize(request)).resolves.toMatchObject({
      model: 'gemini-3.5-flash',
    });
    await expect(minutes.summarize(request)).resolves.toMatchObject({
      model: 'gemini-3.5-flash',
    });
    // The second press goes straight to Gemini: the circuit is open.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps minutes on Gemini under any other selection', async () => {
    const fetchMock = stubCommandCode(() => new Response('', { status: 500 }));
    const draft = await summarizer({
      AI_TRANSLATION_PROVIDER: 'deepseek',
      COMMAND_CODE_API_KEY: 'cc',
      GEMINI_API_KEY: 'g',
    }).summarize(request);

    expect(draft.model).toBe('gemini-3.5-flash');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the Command Code error when no Gemini key stands behind it', async () => {
    stubCommandCode(() => new Response('unauthorized', { status: 401 }));
    const minutes = summarizer({
      AI_TRANSLATION_PROVIDER: 'commandcode',
      COMMAND_CODE_API_KEY: 'cc',
    });
    await expect(minutes.summarize(request)).rejects.toMatchObject({
      status: 401,
    });
  });

  // AI_SUMMARIZATION_PROVIDER names the entry outright, whatever translation runs on.
  it('writes minutes on Gemini direct when AI_SUMMARIZATION_PROVIDER=gemini, even under commandcode', async () => {
    const fetchMock = stubCommandCode(() => new Response('', { status: 500 }));
    const draft = await summarizer({
      AI_TRANSLATION_PROVIDER: 'commandcode',
      AI_SUMMARIZATION_PROVIDER: 'gemini',
      COMMAND_CODE_API_KEY: 'cc',
      GEMINI_API_KEY: 'g',
    }).summarize(request);

    expect(draft.model).toBe('gemini-3.5-flash');
    expect(mockGenerateContent).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes minutes on Command Code when AI_SUMMARIZATION_PROVIDER=commandcode under another translation provider', async () => {
    const fetchMock = stubCommandCode(
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(MINUTES) } }],
          }),
          { status: 200 },
        ),
    );
    const draft = await summarizer({
      AI_TRANSLATION_PROVIDER: 'deepseek',
      AI_SUMMARIZATION_PROVIDER: 'commandcode',
      COMMAND_CODE_API_KEY: 'cc',
      GEMINI_API_KEY: 'g',
    }).summarize(request);

    expect(draft.model).toBe('google/gemini-3.7-flash');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('refuses the derived commandcode selection with no Command Code key', () => {
    // Minutes used to drop to Gemini here. Translation already cannot start in
    // this configuration, so a loud error costs no working deployment.
    expect(() =>
      summarizer({
        AI_TRANSLATION_PROVIDER: 'commandcode',
        GEMINI_API_KEY: 'g',
      }),
    ).toThrow(/apiKey/);
  });

  it('refuses an explicit commandcode selection with no Command Code key', () => {
    // Loud rather than quietly answering from Gemini: a missing key is a
    // deployment error, and falling back would hide it.
    expect(() =>
      summarizer({
        AI_SUMMARIZATION_PROVIDER: 'commandcode',
        GEMINI_API_KEY: 'g',
      }),
    ).toThrow(/apiKey/);
  });
});

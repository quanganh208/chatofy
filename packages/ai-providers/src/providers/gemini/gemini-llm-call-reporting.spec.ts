import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmCallEvent } from '../../interfaces/llm-call-event.js';

/**
 * What the two Gemini providers report per request. The SDK client is replaced
 * so the test controls `usageMetadata`; the field names the providers read are
 * the installed SDK's, which the typecheck holds them to.
 */
const sdk = vi.hoisted(() => ({
  generateContent: vi.fn(),
  generateContentStream: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: sdk.generateContent,
      generateContentStream: sdk.generateContentStream,
    };
  },
}));

const { GeminiSummarizationProvider } = await import('./gemini-summarization-provider.js');
const { GeminiTranslationProvider } = await import('./gemini-translation-provider.js');
const { geminiUsageFields } = await import('./gemini-usage-fields.js');

const MINUTES = {
  summary: 'They agreed to ship on Friday.',
  keyPoints: ['The release is ready'],
  decisions: ['Ship on Friday'],
  actionItems: [],
};

async function* chunks(...items: unknown[]) {
  for (const item of items) yield item;
}

beforeEach(() => {
  sdk.generateContent.mockReset();
  sdk.generateContentStream.mockReset();
});

describe('geminiUsageFields', () => {
  it('counts thinking tokens inside the output', () => {
    expect(
      geminiUsageFields({
        promptTokenCount: 900,
        candidatesTokenCount: 40,
        thoughtsTokenCount: 260,
        cachedContentTokenCount: 512,
      }),
    ).toEqual({ inputTokens: 900, outputTokens: 300, cachedInputTokens: 512 });
  });

  it('treats one missing output count as 0 and both missing as unknown', () => {
    expect(geminiUsageFields({ thoughtsTokenCount: 12 })).toEqual({ outputTokens: 12 });
    expect(geminiUsageFields({ candidatesTokenCount: 7 })).toEqual({ outputTokens: 7 });
    expect(geminiUsageFields({ promptTokenCount: 5 })).toEqual({ inputTokens: 5 });
    expect(geminiUsageFields(undefined)).toEqual({});
  });
});

describe('GeminiSummarizationProvider reporting', () => {
  it('emits a minutes event carrying the usageMetadata counts', async () => {
    const events: LlmCallEvent[] = [];
    sdk.generateContent.mockResolvedValue({
      text: JSON.stringify(MINUTES),
      usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 150, thoughtsTokenCount: 50 },
    });
    const provider = new GeminiSummarizationProvider({
      apiKey: 'k',
      models: ['gemini-3.5-flash'],
      onCall: (e) => events.push(e),
    });

    await provider.summarize({ transcript: 'An: ship it', language: 'en' });

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'minutes',
        host: 'gemini',
        model: 'gemini-3.5-flash',
        ok: true,
        inputTokens: 2000,
        outputTokens: 200,
      }),
    ]);
    expect(events[0]!.cachedInputTokens).toBeUndefined();
    expect(events[0]!.promptHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('emits one event per walked attempt, the failed one included', async () => {
    const events: LlmCallEvent[] = [];
    sdk.generateContent
      .mockRejectedValueOnce(Object.assign(new Error('UNAVAILABLE'), { status: 503 }))
      .mockResolvedValueOnce({ text: JSON.stringify({ title: 'Release plan' }) });
    const provider = new GeminiSummarizationProvider({
      apiKey: 'k',
      models: ['gemini-3.5-flash', 'gemini-3.5-flash-lite'],
      onCall: (e) => events.push(e),
    });

    await expect(provider.title({ transcript: 'An: ship it', language: 'en' })).resolves.toBe(
      'Release plan',
    );

    expect(events.map((e) => [e.kind, e.model, e.ok])).toEqual([
      ['title', 'gemini-3.5-flash', false],
      ['title', 'gemini-3.5-flash-lite', true],
    ]);
    // No usage on the response: every count stays unknown rather than 0.
    expect(events[1]!.inputTokens).toBeUndefined();
    expect(events[1]!.outputTokens).toBeUndefined();
  });
});

describe('GeminiTranslationProvider reporting', () => {
  it('reads the counts off the last stream chunk and carries the purpose', async () => {
    const events: LlmCallEvent[] = [];
    sdk.generateContentStream.mockResolvedValue(
      chunks(
        { text: 'Hello ' },
        {
          text: 'world',
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 410,
            candidatesTokenCount: 6,
            thoughtsTokenCount: 30,
            cachedContentTokenCount: 256,
          },
        },
      ),
    );
    const provider = new GeminiTranslationProvider({
      apiKey: 'k',
      models: ['gemini-3.5-flash-lite'],
      onCall: (e) => events.push(e),
    });

    await provider.translate({
      text: 'xin chào thế giới',
      sourceLanguage: 'vi',
      targetLanguage: 'en',
      purpose: 'final',
    });

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'translate',
        purpose: 'final',
        host: 'gemini',
        model: 'gemini-3.5-flash-lite',
        ok: true,
        inputTokens: 410,
        outputTokens: 36,
        cachedInputTokens: 256,
      }),
    ]);
  });

  it('emits a failed event when the stream breaks, and a throwing listener changes nothing', async () => {
    const events: LlmCallEvent[] = [];
    sdk.generateContentStream.mockRejectedValue(new Error('socket hang up'));
    const provider = new GeminiTranslationProvider({
      apiKey: 'k',
      models: ['gemini-3.5-flash-lite'],
      onCall: (e) => events.push(e),
    });
    await expect(
      provider.translate({ text: 'xin chào', sourceLanguage: 'vi', targetLanguage: 'en' }),
    ).rejects.toThrow();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'translate', ok: false });
    expect(events[0]!.purpose).toBeUndefined();

    sdk.generateContentStream.mockResolvedValue(chunks({ text: 'hello' }));
    const broken = new GeminiTranslationProvider({
      apiKey: 'k',
      models: ['gemini-3.5-flash-lite'],
      onCall: () => {
        throw new Error('sink down');
      },
    });
    await expect(
      broken.translate({ text: 'xin chào', sourceLanguage: 'vi', targetLanguage: 'en' }),
    ).resolves.toMatchObject({ text: 'hello' });
  });
});

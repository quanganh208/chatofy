// `mock`-prefixed so jest's hoisted factory may reference it.
const mockGenerateContentStream = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContentStream: mockGenerateContentStream },
  })),
}));

import {
  GeminiTranslationProvider,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '@chatofy/ai-providers';

/**
 * A re-iterable stand-in for the SDK's streamed response. Re-iterable matters:
 * `mockResolvedValue` hands the same object to every call, and a bare async
 * generator would be exhausted after the first one.
 */
const streamOf = (...chunks: Record<string, unknown>[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield chunk;
  },
});

/** The common case: a whole short translation arriving in one chunk. */
const oneChunk = (text: string) => streamOf({ text, candidates: [] });

describe('GeminiTranslationProvider', () => {
  beforeEach(() => mockGenerateContentStream.mockReset());

  const req = {
    text: 'xin chào',
    sourceLanguage: 'vi',
    targetLanguage: 'en',
  } as const;

  it('throws ProviderConfigError without an apiKey', () => {
    expect(() => new GeminiTranslationProvider({})).toThrow(
      ProviderConfigError,
    );
  });

  /** Arguments of the nth recorded call — `jest.fn()` records them as `any`. */
  const callArgs = (index: number) => {
    const call = mockGenerateContentStream.mock.calls[index] as
      | [
          {
            model: string;
            contents: string;
            config?: { systemInstruction?: string };
          },
        ]
      | undefined;
    if (!call) throw new Error(`generateContent call ${index} was never made`);
    return call[0];
  };

  /** The SDK reports a quota rejection as an error carrying the raw JSON body. */
  const quotaError = () =>
    new Error(
      '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED",' +
        '"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}',
    );

  /** A per-minute rejection, which unlike the daily one states when it heals. */
  const perMinuteQuotaError = (retryDelaySeconds: number) =>
    new Error(
      '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED",' +
        '"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier",' +
        `"retryDelay":"${retryDelaySeconds}s"}}`,
    );

  it('returns the trimmed translated text and the model that produced it', async () => {
    mockGenerateContentStream.mockResolvedValue(oneChunk('  hello  '));
    const provider = new GeminiTranslationProvider({
      apiKey: 'k',
      models: ['gemini-3.5-flash-lite'],
    });
    await expect(provider.translate(req)).resolves.toEqual({
      text: 'hello',
      model: 'gemini-3.5-flash-lite',
    });
  });

  it('sends no thinking configuration', async () => {
    // Verified against the live API: the 3.x models reject `thinkingBudget`
    // with a 400 and Gemma rejects every thinking field, so sending one breaks
    // the only request shape all the models in the list accept.
    mockGenerateContentStream.mockResolvedValue(oneChunk('hello'));
    await new GeminiTranslationProvider({ apiKey: 'k' }).translate(req);

    const { config } = callArgs(0);
    expect(config).not.toHaveProperty('thinkingConfig');
    expect(config?.systemInstruction).toContain('professional translator');
  });

  it('throws ProviderResponseError on an empty/blocked response', async () => {
    mockGenerateContentStream.mockResolvedValue(
      streamOf({ text: '', candidates: [{ finishReason: 'SAFETY' }] }),
    );
    const provider = new GeminiTranslationProvider({ apiKey: 'k' });
    await expect(provider.translate(req)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it('wraps SDK failures in ProviderConnectionError', async () => {
    mockGenerateContentStream.mockRejectedValue(new Error('network'));
    const provider = new GeminiTranslationProvider({ apiKey: 'k' });
    await expect(provider.translate(req)).rejects.toBeInstanceOf(
      ProviderConnectionError,
    );
  });

  // The free tier meters daily requests per project PER MODEL, so a model that
  // is out of quota says nothing about the next one — that is what makes
  // walking the list worth doing.
  describe('daily quota fallback', () => {
    const models = ['model-a', 'model-b', 'model-c'];
    const withLadder = () =>
      new GeminiTranslationProvider({ apiKey: 'k', models });

    it('moves to the next model and reports which one answered', async () => {
      mockGenerateContentStream
        .mockRejectedValueOnce(quotaError())
        .mockResolvedValueOnce(oneChunk('hello'));

      await expect(withLadder().translate(req)).resolves.toEqual({
        text: 'hello',
        model: 'model-b',
      });
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(2);
      expect(callArgs(0).model).toBe('model-a');
      expect(callArgs(1).model).toBe('model-b');
    });

    // A caller that cannot afford the configured ladder brings its own. A live
    // conversation is the case: the provider's last resort is measured in
    // seconds, which a speaker has long stopped waiting for.
    it('uses the ladder the request brings instead of the configured one', async () => {
      mockGenerateContentStream
        .mockRejectedValueOnce(quotaError())
        .mockResolvedValueOnce(oneChunk('hello'));

      await expect(
        withLadder().translate({ ...req, models: ['fast-a', 'fast-b'] }),
      ).resolves.toEqual({ text: 'hello', model: 'fast-b' });
      expect(callArgs(0).model).toBe('fast-a');
      expect(callArgs(1).model).toBe('fast-b');
      // The configured models were never reached, so a slow last resort the
      // caller excluded cannot answer behind its back.
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(2);
    });

    it('keeps the configured ladder when the request names none', async () => {
      mockGenerateContentStream.mockResolvedValueOnce(oneChunk('hello'));

      await withLadder().translate({ ...req, models: undefined });

      expect(callArgs(0).model).toBe('model-a');
    });

    it('walks the whole list before giving up', async () => {
      mockGenerateContentStream.mockRejectedValue(quotaError());

      await expect(withLadder().translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(models.length);
    });

    it('stops at a failure the next model would repeat', async () => {
      mockGenerateContentStream.mockRejectedValue(new Error('socket hang up'));

      await expect(withLadder().translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
    });

    it('walks a distinct built-in ladder that keeps the slow reserve last', async () => {
      // No `models` argument — this is the production path, so the built-in
      // list carries the invariants the fallback rests on. Quota is metered per
      // model, so a repeated entry would buy zero headroom; and the deep reserve
      // is an order of magnitude slower per sentence, so it must come last —
      // every turn that reaches it pays seconds instead of milliseconds. Which
      // of the two flash models leads is a product call, not an invariant: they
      // measured within 4ms of each other on the streamed path. Driving the walk
      // to exhaustion reveals the real list without exporting it.
      mockGenerateContentStream.mockRejectedValue(quotaError());

      await expect(
        new GeminiTranslationProvider({ apiKey: 'k' }).translate(req),
      ).rejects.toBeInstanceOf(ProviderConnectionError);

      const walked = mockGenerateContentStream.mock.calls.map(
        (_, i) => callArgs(i).model,
      );
      expect(walked.at(-1)).toBe('gemma-4-31b-it');
      expect(walked.length).toBeGreaterThan(1);
      expect(new Set(walked).size).toBe(walked.length);
    });

    // The per-minute ceiling (15/min measured) is what a live conversation
    // hits, and it heals on its own. Remembering it keeps one throttled turn
    // from taxing every later turn with a round-trip that can only 429.
    it('skips a model still inside its own retryDelay', async () => {
      mockGenerateContentStream
        .mockRejectedValueOnce(perMinuteQuotaError(52))
        .mockResolvedValue(oneChunk('hello'));
      const provider = withLadder();

      await expect(provider.translate(req)).resolves.toEqual({
        text: 'hello',
        model: 'model-b',
      });
      mockGenerateContentStream.mockClear();

      // Second turn must go straight to model-b — model-a is still cooling.
      await expect(provider.translate(req)).resolves.toEqual({
        text: 'hello',
        model: 'model-b',
      });
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
      expect(callArgs(0).model).toBe('model-b');
    });

    it('retries a model once its cooldown has elapsed', async () => {
      jest.useFakeTimers();
      try {
        mockGenerateContentStream
          .mockRejectedValueOnce(perMinuteQuotaError(52))
          .mockResolvedValue(oneChunk('hello'));
        const provider = withLadder();
        await provider.translate(req);

        jest.advanceTimersByTime(53_000);
        mockGenerateContentStream.mockClear();

        await expect(provider.translate(req)).resolves.toEqual({
          text: 'hello',
          model: 'model-a',
        });
        expect(callArgs(0).model).toBe('model-a');
      } finally {
        jest.useRealTimers();
      }
    });

    it('reports when every model is cooling instead of a phantom request', async () => {
      mockGenerateContentStream.mockRejectedValue(perMinuteQuotaError(52));
      const provider = withLadder();
      await expect(provider.translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      mockGenerateContentStream.mockClear();

      await expect(provider.translate(req)).rejects.toThrow(/rate limited/);
      expect(mockGenerateContentStream).not.toHaveBeenCalled();
    });

    it('makes a single attempt for a single-model list', async () => {
      mockGenerateContentStream.mockRejectedValue(quotaError());
      const provider = new GeminiTranslationProvider({
        apiKey: 'k',
        models: ['model-a'],
      });

      await expect(provider.translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
    });
  });
});

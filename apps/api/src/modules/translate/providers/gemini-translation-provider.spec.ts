// `mock`-prefixed so jest's hoisted factory may reference it.
const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

import {
  GeminiTranslationProvider,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '@chatofy/ai-providers';

describe('GeminiTranslationProvider', () => {
  beforeEach(() => mockGenerateContent.mockReset());

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
    const call = mockGenerateContent.mock.calls[index] as
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

  it('returns the trimmed translated text and the model that produced it', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '  hello  ',
      candidates: [],
    });
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
    mockGenerateContent.mockResolvedValue({ text: 'hello', candidates: [] });
    await new GeminiTranslationProvider({ apiKey: 'k' }).translate(req);

    const { config } = callArgs(0);
    expect(config).not.toHaveProperty('thinkingConfig');
    expect(config?.systemInstruction).toContain('professional translator');
  });

  it('throws ProviderResponseError on an empty/blocked response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '',
      candidates: [{ finishReason: 'SAFETY' }],
    });
    const provider = new GeminiTranslationProvider({ apiKey: 'k' });
    await expect(provider.translate(req)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it('wraps SDK failures in ProviderConnectionError', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network'));
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
      mockGenerateContent
        .mockRejectedValueOnce(quotaError())
        .mockResolvedValueOnce({ text: 'hello', candidates: [] });

      await expect(withLadder().translate(req)).resolves.toEqual({
        text: 'hello',
        model: 'model-b',
      });
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      expect(callArgs(0).model).toBe('model-a');
      expect(callArgs(1).model).toBe('model-b');
    });

    it('walks the whole list before giving up', async () => {
      mockGenerateContent.mockRejectedValue(quotaError());

      await expect(withLadder().translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(models.length);
    });

    it('stops at a failure the next model would repeat', async () => {
      mockGenerateContent.mockRejectedValue(new Error('socket hang up'));

      await expect(withLadder().translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('makes a single attempt for a single-model list', async () => {
      mockGenerateContent.mockRejectedValue(quotaError());
      const provider = new GeminiTranslationProvider({
        apiKey: 'k',
        models: ['model-a'],
      });

      await expect(provider.translate(req)).rejects.toBeInstanceOf(
        ProviderConnectionError,
      );
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});

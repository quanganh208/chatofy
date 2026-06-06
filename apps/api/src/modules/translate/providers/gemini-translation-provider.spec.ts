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

  it('returns the trimmed translated text', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '  hello  ',
      candidates: [],
    });
    const provider = new GeminiTranslationProvider({ apiKey: 'k' });
    await expect(provider.translate(req)).resolves.toEqual({ text: 'hello' });
  });

  it('throws ProviderConnectionError on an empty/blocked response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: '',
      candidates: [{ finishReason: 'SAFETY' }],
    });
    const provider = new GeminiTranslationProvider({ apiKey: 'k' });
    await expect(provider.translate(req)).rejects.toBeInstanceOf(
      ProviderConnectionError,
    );
  });

  it('wraps SDK failures in ProviderConnectionError', async () => {
    mockGenerateContent.mockRejectedValue(new Error('network'));
    const provider = new GeminiTranslationProvider({ apiKey: 'k' });
    await expect(provider.translate(req)).rejects.toBeInstanceOf(
      ProviderConnectionError,
    );
  });
});

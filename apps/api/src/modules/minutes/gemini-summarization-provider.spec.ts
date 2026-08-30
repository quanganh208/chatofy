// `mock`-prefixed so jest's hoisted factory may reference it.
const mockGenerateContent = jest.fn();
/** API keys handed to the SDK constructor, in construction order. */
const mockConstructedKeys: string[] = [];

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation((config: { apiKey: string }) => {
    mockConstructedKeys.push(config.apiKey);
    return {
      models: {
        // Key rides along as a second argument so assertions on the request
        // object (the first) stay unchanged while the key is still observable.
        generateContent: (params: unknown): unknown =>
          mockGenerateContent(params, config.apiKey) as unknown,
      },
    };
  }),
}));

import {
  GeminiSummarizationProvider,
  ProviderConfigError,
  ProviderResponseError,
} from '@chatofy/ai-providers';

const req = {
  transcript: 'Speaker 1: hello\nSpeaker 2: hi',
  language: 'en',
} as const;

const validBody = {
  summary: 'They greeted each other.',
  keyPoints: ['greeting'],
  decisions: ['meet again'],
  actionItems: [
    { description: 'send notes', owner: 'Speaker 1', dueDate: 'Friday' },
  ],
};

describe('GeminiSummarizationProvider', () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockConstructedKeys.length = 0;
  });

  it('throws ProviderConfigError without an apiKey', () => {
    expect(() => new GeminiSummarizationProvider({})).toThrow(
      ProviderConfigError,
    );
  });

  it('parses a valid JSON body into a draft, reporting the model that ran', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(validBody) });
    const provider = new GeminiSummarizationProvider({ apiKey: 'k' });

    const draft = await provider.summarize(req);

    expect(draft).toEqual({
      summary: 'They greeted each other.',
      keyPoints: ['greeting'],
      decisions: ['meet again'],
      actionItems: [
        { description: 'send notes', owner: 'Speaker 1', dueDate: 'Friday' },
      ],
      model: 'gemini-3.5-flash',
    });
  });

  it('coerces a partial object — missing arrays become empty, missing summary empty', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ summary: 'only a summary' }),
    });
    const provider = new GeminiSummarizationProvider({ apiKey: 'k' });

    const draft = await provider.summarize(req);

    expect(draft).toMatchObject({
      summary: 'only a summary',
      keyPoints: [],
      decisions: [],
      actionItems: [],
    });
  });

  it('drops action items with no description and nulls non-string owner/dueDate', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        actionItems: [
          { description: 'kept', owner: 42, dueDate: null },
          { owner: 'no description so dropped' },
          { description: '', owner: 'empty description dropped' },
        ],
      }),
    });
    const provider = new GeminiSummarizationProvider({ apiKey: 'k' });

    const draft = await provider.summarize(req);

    expect(draft.actionItems).toEqual([
      { description: 'kept', owner: null, dueDate: null },
    ]);
  });

  it('throws ProviderResponseError on a non-JSON body', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'sorry, here are your minutes:',
    });
    const provider = new GeminiSummarizationProvider({ apiKey: 'k' });
    await expect(provider.summarize(req)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it('throws ProviderResponseError on an empty body', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' });
    const provider = new GeminiSummarizationProvider({ apiKey: 'k' });
    await expect(provider.summarize(req)).rejects.toBeInstanceOf(
      ProviderResponseError,
    );
  });

  it('requests application/json so the body is a document, not prose', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(validBody) });
    const provider = new GeminiSummarizationProvider({ apiKey: 'k' });
    await provider.summarize(req);

    const [params] = mockGenerateContent.mock.calls[0] as [
      { config?: { responseMimeType?: string } },
    ];
    expect(params.config?.responseMimeType).toBe('application/json');
  });
});

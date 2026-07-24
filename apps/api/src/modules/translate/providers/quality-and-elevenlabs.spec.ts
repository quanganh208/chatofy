import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  ProviderConfigError,
  ProviderError,
  ProviderResponseError,
  resolveQualityProfile,
} from '@chatofy/ai-providers';

describe('resolveQualityProfile', () => {
  it('returns the speed tier for low values', () => {
    expect(resolveQualityProfile(0).ttsModel).toBe('eleven_flash_v2_5');
  });

  it('returns the balanced tier for mid values', () => {
    expect(resolveQualityProfile(0.5).ttsModel).toBe('eleven_turbo_v2_5');
  });

  it('returns the quality tier for high values', () => {
    // Top tier signals premium through the multilingual voice; the translate
    // model is picked by quota rather than by tier.
    expect(resolveQualityProfile(0.9).ttsModel).toBe('eleven_multilingual_v2');
  });

  it('clamps out-of-range input', () => {
    expect(resolveQualityProfile(-2).ttsModel).toBe('eleven_flash_v2_5');
    expect(resolveQualityProfile(99).ttsModel).toBe('eleven_multilingual_v2');
  });

  it('offers distinct translation models so one quota cannot exhaust the rest', () => {
    // The free tier meters requests per project PER MODEL, so a fallback entry
    // only buys headroom while it names a different model.
    const { translationModels } = resolveQualityProfile(0.5);
    expect(translationModels[0]).toBe('gemini-3.5-flash-lite');
    expect(new Set(translationModels).size).toBe(translationModels.length);
  });

  it('gives every tier the same translation models', () => {
    expect(resolveQualityProfile(0).translationModels).toEqual(
      resolveQualityProfile(1).translationModels,
    );
  });
});

describe('ElevenLabs providers', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('STT throws ProviderConfigError without an apiKey', () => {
    expect(() => new ElevenLabsSttProvider({})).toThrow(ProviderConfigError);
  });

  it('STT returns the transcript on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'xin chào', language_code: 'vi' }),
    });

    const provider = new ElevenLabsSttProvider({ apiKey: 'k' });
    const result = await provider.transcribe(
      new Uint8Array([1, 2]),
      'audio/webm',
      'vi',
    );
    expect(result).toEqual({ text: 'xin chào', language: 'vi' });
  });

  it('STT maps a non-2xx response to ProviderResponseError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });

    const provider = new ElevenLabsSttProvider({ apiKey: 'k' });
    const err = await provider
      .transcribe(new Uint8Array([1]), 'audio/webm', 'vi')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderResponseError);
    expect(err).toBeInstanceOf(ProviderError);
  });

  it('STT maps a malformed response body to ProviderResponseError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    });

    const provider = new ElevenLabsSttProvider({ apiKey: 'k' });
    await expect(
      provider.transcribe(new Uint8Array([1]), 'audio/webm', 'vi'),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('TTS throws ProviderConfigError without an apiKey', () => {
    expect(() => new ElevenLabsTtsProvider({})).toThrow(ProviderConfigError);
  });

  it('TTS returns audio bytes on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer,
    });

    const provider = new ElevenLabsTtsProvider({ apiKey: 'k' });
    const bytes = await provider.synthesize({
      text: 'hello',
      language: 'en',
      audioFormat: { encoding: 'pcm16', sampleRate: 44100, channels: 1 },
    });
    expect(Array.from(bytes)).toEqual([4, 5, 6]);
  });

  it('TTS exposes the mp3 output MIME type', () => {
    const provider = new ElevenLabsTtsProvider({ apiKey: 'k' });
    expect(provider.outputMimeType).toBe('audio/mpeg');
  });

  it('TTS puts a per-request voice id in the request path', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    global.fetch = fetchMock;

    const provider = new ElevenLabsTtsProvider({
      apiKey: 'k',
      voice: 'aaaaaaaaaaaaaaaaaaaa',
    });
    await provider.synthesize({
      text: 'hello',
      language: 'en',
      voice: 'bbbbbbbbbbbbbbbbbbbb',
      audioFormat: { encoding: 'pcm16', sampleRate: 44100, channels: 1 },
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'bbbbbbbbbbbbbbbbbbbb',
    );
  });

  it('TTS ignores a voice that is not an ElevenLabs id', async () => {
    // The web app sends a preset NAME for en→vi. Interpolating that into the
    // request path yields a 404, so the configured voice id must win instead.
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    global.fetch = fetchMock;

    const provider = new ElevenLabsTtsProvider({
      apiKey: 'k',
      voice: 'aaaaaaaaaaaaaaaaaaaa',
    });
    await provider.synthesize({
      text: 'xin chào',
      language: 'vi',
      voice: 'Phạm Tuyên',
      audioFormat: { encoding: 'pcm16', sampleRate: 44100, channels: 1 },
    });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('aaaaaaaaaaaaaaaaaaaa');
    expect(url).not.toContain('Tuy');
    expect(decodeURIComponent(url)).not.toContain('Phạm');
  });
});

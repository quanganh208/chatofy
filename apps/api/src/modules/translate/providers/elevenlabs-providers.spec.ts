import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  ProviderConfigError,
  ProviderError,
  ProviderResponseError,
} from '@chatofy/ai-providers';

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

  it.each(['female', 'male'] as const)(
    'TTS speaks in its configured voice whatever gender is asked for (%s)',
    async (voiceGender) => {
      // One configured id is one voice of one gender. This backend is the cloud
      // comparison baseline, so it answers every request in that voice rather
      // than guessing which ElevenLabs voice is its counterpart.
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
        voiceGender,
        audioFormat: { encoding: 'pcm16', sampleRate: 44100, channels: 1 },
      });

      expect(String(fetchMock.mock.calls[0][0])).toContain(
        'aaaaaaaaaaaaaaaaaaaa',
      );
    },
  );
});

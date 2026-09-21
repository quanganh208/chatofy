import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  LocalSpeechSttProvider,
  LocalSpeechTtsProvider,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderError,
  ProviderResponseError,
  type TtsSynthesizeRequest,
} from '@chatofy/ai-providers';

const audio = new Uint8Array([1, 2, 3, 4]);

/** Typed view of a captured fetch call — keeps the assertions free of `any`. */
function callArgs(mock: Mock, index = 0): [string, RequestInit] {
  return mock.mock.calls[index] as [string, RequestInit];
}

const ttsReq: TtsSynthesizeRequest = {
  text: 'Hello there',
  language: 'en',
  audioFormat: { encoding: 'pcm16', sampleRate: 48000, channels: 1 },
};

describe('LocalSpeechSttProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('throws ProviderConfigError without a baseUrl', () => {
    expect(() => new LocalSpeechSttProvider({})).toThrow(ProviderConfigError);
  });

  it('posts multipart audio and returns the transcript', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'Xin chào', language: 'vi' }),
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    await expect(
      provider.transcribe(audio, 'audio/webm', 'vi'),
    ).resolves.toEqual({ text: 'Xin chào', language: 'vi' });

    const [url, init] = callArgs(fetchMock);
    expect(url).toBe('http://localhost:8002/transcribe');
    // The sidecar picks the engine from this field, so it must be sent.
    const form = init.body as FormData;
    expect(form.get('language')).toBe('vi');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('sends each hotword as its own field, skipping blank ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'giải poker', language: 'vi' }),
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    await provider.transcribe(audio, 'audio/webm', 'vi', {
      hotwords: ['poker', '   ', 'Target'],
    });

    const form = callArgs(fetchMock)[1].body as FormData;
    // One field per term: a single delimited field would split a term that
    // happened to contain the sidecar's separator.
    expect(form.getAll('hotwords')).toEqual(['poker', 'Target']);
  });

  it('sends no hotword field when the caller named none', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hi', language: 'en' }),
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    await provider.transcribe(audio, 'audio/wav', 'en');

    expect(
      (callArgs(fetchMock)[1].body as FormData).getAll('hotwords'),
    ).toEqual([]);
  });

  it('trims a trailing slash on the baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hi', language: 'en' }),
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002/',
    });
    await provider.transcribe(audio, 'audio/wav', 'en');
    expect(callArgs(fetchMock)[0]).toBe('http://localhost:8002/transcribe');
  });

  it('echoes the requested language rather than trusting the response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello' }), // no language field
    });

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    await expect(
      provider.transcribe(audio, 'audio/wav', 'en'),
    ).resolves.toEqual({ text: 'hello', language: 'en' });
  });

  it('keeps an empty transcript — silence is a valid result, not an error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '', language: 'vi' }),
    });

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    // The pipeline turns this into "No speech detected"; the provider must not.
    await expect(
      provider.transcribe(audio, 'audio/webm', 'vi'),
    ).resolves.toEqual({ text: '', language: 'vi' });
  });

  it('throws ProviderResponseError on a malformed body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    });

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    await expect(
      provider.transcribe(audio, 'audio/wav', 'en'),
    ).rejects.toBeInstanceOf(ProviderResponseError);
  });

  it('throws ProviderResponseError on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'unsupported language',
    });

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    const err = await provider
      .transcribe(audio, 'audio/wav', 'en')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderResponseError);
    expect(err).toBeInstanceOf(ProviderError);
  });

  it('wraps fetch failures in ProviderConnectionError with cause preserved', async () => {
    // The common failure once local is the default: the sidecar is not running.
    const netErr = new Error('ECONNREFUSED');
    global.fetch = vi.fn().mockRejectedValue(netErr);

    const provider = new LocalSpeechSttProvider({
      baseUrl: 'http://localhost:8002',
    });
    const err = await provider
      .transcribe(audio, 'audio/wav', 'en')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderConnectionError);
    expect((err as ProviderConnectionError).cause).toBe(netErr);
  });
});

describe('LocalSpeechTtsProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('throws ProviderConfigError without a baseUrl', () => {
    expect(() => new LocalSpeechTtsProvider({})).toThrow(ProviderConfigError);
  });

  it('exposes the wav output MIME type', () => {
    const provider = new LocalSpeechTtsProvider({
      baseUrl: 'http://localhost:8003',
    });
    expect(provider.outputMimeType).toBe('audio/wav');
  });

  it('posts the text and language and returns the wav bytes', async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => wav.buffer,
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechTtsProvider({
      baseUrl: 'http://localhost:8003/',
    });
    await expect(provider.synthesize(ttsReq)).resolves.toEqual(wav);

    const [url, init] = callArgs(fetchMock);
    expect(url).toBe('http://localhost:8003/synthesize'); // trailing slash trimmed
    // language is sent so the sidecar's English-only guard is meaningful.
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'Hello there',
      language: 'en',
    });
  });

  it('sends the requested gender as the sidecar names it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array().buffer,
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechTtsProvider({
      baseUrl: 'http://localhost:8003',
    });
    // The provider passes the gender along and stops there — which voice it
    // means belongs to the engine standing behind the language.
    await provider.synthesize({
      ...ttsReq,
      language: 'vi',
      voiceGender: 'male',
    });

    expect(JSON.parse(callArgs(fetchMock)[1].body as string)).toEqual({
      text: 'Hello there',
      language: 'vi',
      gender: 'male',
    });
  });

  it('omits gender entirely when the request has none', async () => {
    // The sidecar owns the fallback; naming one here would put this package in
    // the business of deciding whose voice a caller meant.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array().buffer,
    });
    global.fetch = fetchMock;

    const provider = new LocalSpeechTtsProvider({
      baseUrl: 'http://localhost:8003',
    });
    await provider.synthesize({ ...ttsReq, language: 'vi' });

    expect(JSON.parse(callArgs(fetchMock)[1].body as string)).toEqual({
      text: 'Hello there',
      language: 'vi',
    });
  });

  it('throws ProviderResponseError on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => 'model not loaded',
    });

    const provider = new LocalSpeechTtsProvider({
      baseUrl: 'http://localhost:8003',
    });
    const err = await provider.synthesize(ttsReq).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderResponseError);
    expect(err).toBeInstanceOf(ProviderError);
  });

  it('wraps fetch failures in ProviderConnectionError with cause preserved', async () => {
    const netErr = new Error('ECONNREFUSED');
    global.fetch = vi.fn().mockRejectedValue(netErr);

    const provider = new LocalSpeechTtsProvider({
      baseUrl: 'http://localhost:8003',
    });
    const err = await provider.synthesize(ttsReq).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderConnectionError);
    expect((err as ProviderConnectionError).cause).toBe(netErr);
  });
});

import {
  VieNeuTtsProvider,
  ProviderConfigError,
  ProviderConnectionError,
  type TtsSynthesizeRequest,
} from '@chatofy/ai-providers';

const req: TtsSynthesizeRequest = {
  text: 'Xin chào',
  language: 'vi',
  audioFormat: { encoding: 'pcm16', sampleRate: 48000, channels: 1 },
};

describe('VieNeuTtsProvider', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('throws ProviderConfigError without a baseUrl', () => {
    expect(() => new VieNeuTtsProvider({})).toThrow(ProviderConfigError);
  });

  it('returns the synthesized wav bytes', async () => {
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => wav.buffer,
    });
    global.fetch = fetchMock;

    const provider = new VieNeuTtsProvider({
      baseUrl: 'http://localhost:8001',
    });
    await expect(provider.synthesize(req)).resolves.toEqual(wav);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8001/synthesize');
    expect(JSON.parse(init.body)).toEqual({ text: 'Xin chào' });
  });

  it('sends the per-request voice, overriding the default', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array().buffer,
    });
    global.fetch = fetchMock;

    const provider = new VieNeuTtsProvider({
      baseUrl: 'http://localhost:8001/',
      voice: 'Phạm Tuyên',
    });
    await provider.synthesize({ ...req, voice: 'Thái Sơn' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8001/synthesize'); // trailing slash trimmed
    expect(JSON.parse(init.body)).toEqual({
      text: 'Xin chào',
      voice: 'Thái Sơn',
    });
  });

  it('throws ProviderConnectionError on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    });

    const provider = new VieNeuTtsProvider({
      baseUrl: 'http://localhost:8001',
    });
    await expect(provider.synthesize(req)).rejects.toBeInstanceOf(
      ProviderConnectionError,
    );
  });

  it('wraps fetch failures in ProviderConnectionError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));

    const provider = new VieNeuTtsProvider({
      baseUrl: 'http://localhost:8001',
    });
    await expect(provider.synthesize(req)).rejects.toBeInstanceOf(
      ProviderConnectionError,
    );
  });
});

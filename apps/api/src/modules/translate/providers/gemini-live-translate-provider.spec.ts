import { beforeEach, describe, expect, it, vi } from 'vitest';
// `mock`-prefixed so vitest's hoisted factory may reference them.
const mockConnect = vi.fn();
/** API keys handed to the SDK constructor, in construction order. */
const mockConstructedKeys: string[] = [];

/**
 * One fake socket per `connect`, NOT one shared between them.
 *
 * A single shared session object cannot tell apart "both sessions got the
 * audio" from "the audio went to the right one", and routing by handle is
 * exactly what the continuous path will depend on.
 */
interface FakeSocket {
  callbacks: Record<string, (arg: unknown) => void>;
  sent: { audio: { data: string; mimeType: string } }[];
  closes: number;
  /** Set to make the next send throw, as a dying socket does. */
  sendThrows?: Error;
}
const mockSockets: FakeSocket[] = [];

vi.mock('@google/genai', () => ({
  Modality: { AUDIO: 'AUDIO' },
  // A function expression rather than an arrow: the provider reaches this
  // through `new GoogleGenAI(...)`, and an arrow cannot be constructed.
  GoogleGenAI: vi.fn(function (config: { apiKey: string }) {
    mockConstructedKeys.push(config.apiKey);
    return {
      live: {
        connect: (params: unknown): unknown => mockConnect(params),
      },
    };
  }),
}));

import {
  GeminiLiveTranslateProvider,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderRegistry,
  type RealtimeStartParams,
  type RealtimeStreamEvents,
} from '@chatofy/ai-providers';
import { registerDefaultProviders } from './register-default-providers';

type ConnectParams = { callbacks: Record<string, (arg: unknown) => void> };

/** Build a fake socket bound to the callbacks the provider just registered. */
function makeSocket(params: ConnectParams): {
  socket: FakeSocket;
  session: { sendRealtimeInput: (i: never) => void; close: () => void };
} {
  const socket: FakeSocket = {
    callbacks: params.callbacks,
    sent: [],
    closes: 0,
  };
  mockSockets.push(socket);
  return {
    socket,
    session: {
      sendRealtimeInput: (input: never): void => {
        if (socket.sendThrows) throw socket.sendThrows;
        socket.sent.push(input);
      },
      close: (): void => {
        socket.closes += 1;
      },
    },
  };
}

const params: RealtimeStartParams = {
  sourceLanguage: 'vi',
  targetLanguage: 'en',
  audioFormat: { encoding: 'pcm16', sampleRate: 16000, channels: 1 },
};

/** One base64 audio part, shaped exactly as the live API returns it. */
const audioMessage = (b64: string, mimeType = 'audio/pcm;rate=24000') => ({
  serverContent: {
    modelTurn: { parts: [{ inlineData: { data: b64, mimeType } }] },
  },
});

/** Collects everything a session reports, so a test can assert on one object. */
function recorder() {
  const seen = {
    source: [] as [string, string][],
    target: [] as string[],
    audio: [] as [number, number][],
    errors: [] as string[],
    warnings: [] as string[],
    closes: [] as (string | undefined)[],
  };
  const events: RealtimeStreamEvents = {
    onSourceTranscript: (delta, lang) => seen.source.push([delta, lang]),
    onTargetTranscript: (delta) => seen.target.push(delta),
    onTranslatedAudio: (chunk, rate) => seen.audio.push([chunk.length, rate]),
    onWarning: (warning) => seen.warnings.push(warning.message),
    onError: (err) => seen.errors.push(err.message),
    onClose: (reason) => seen.closes.push(reason),
  };
  return { seen, events };
}

describe('GeminiLiveTranslateProvider', () => {
  beforeEach(() => {
    mockConstructedKeys.length = 0;
    mockSockets.length = 0;
    mockConnect.mockReset().mockImplementation((p: ConnectParams) => {
      return Promise.resolve(makeSocket(p).session);
    });
  });

  describe('configuration', () => {
    it('throws ProviderConfigError without a usable apiKey', () => {
      expect(() => new GeminiLiveTranslateProvider({})).toThrow(
        ProviderConfigError,
      );
      expect(
        () => new GeminiLiveTranslateProvider({ apiKey: '  ,  ' }),
      ).toThrow(ProviderConfigError);
    });

    it('uses only the first key of a comma-separated pool', async () => {
      const provider = new GeminiLiveTranslateProvider({
        apiKey: 'first,second,third',
      });
      await provider.start(params, {});
      expect(mockConstructedKeys).toEqual(['first']);
    });

    /**
     * The mechanism the fixture harness depends on: it opens one session per
     * utterance and walks the key pool itself, because the provider cannot.
     */
    it('lets a caller override the key for one session', async () => {
      const provider = new GeminiLiveTranslateProvider({
        apiKey: 'configured',
      });
      await provider.start({ ...params, apiKey: 'per-session' }, {});
      expect(mockConstructedKeys).toEqual(['per-session']);
    });

    it.each(['', '   '])(
      'ignores a blank override (%p) instead of passing it to the SDK',
      async (blank) => {
        const provider = new GeminiLiveTranslateProvider({
          apiKey: 'configured',
        });
        await provider.start({ ...params, apiKey: blank }, {});
        // A pool walked with a trailing comma produces exactly this, and the
        // SDK would fail later with an opaque message instead of falling back.
        expect(mockConstructedKeys).toEqual(['configured']);
      },
    );

    it('asks for the target language and silences same-language input', async () => {
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start({ ...params, targetLanguage: 'vi' }, {});
      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-3.5-live-translate-preview',
          config: expect.objectContaining({
            translationConfig: {
              targetLanguageCode: 'vi',
              echoTargetLanguage: false,
            },
          }) as unknown,
        }) as unknown,
      );
    });

    it.each([
      [
        'a rate the model does not accept',
        { encoding: 'pcm16', sampleRate: 48000, channels: 1 },
      ],
      ['stereo', { encoding: 'pcm16', sampleRate: 16000, channels: 2 }],
      [
        'a non-PCM encoding',
        { encoding: 'opus', sampleRate: 16000, channels: 1 },
      ],
    ] as const)('refuses %s', async (_label, audioFormat) => {
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await expect(
        provider.start({ ...params, audioFormat }, {}),
      ).rejects.toThrow(ProviderConfigError);
    });
  });

  describe('connect failures', () => {
    it('wraps a rejected connect in ProviderConnectionError', async () => {
      mockConnect.mockRejectedValueOnce(new Error('dns'));
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await expect(provider.start(params, {})).rejects.toThrow(
        ProviderConnectionError,
      );
    });

    /**
     * The Live API reports a rejected key or exhausted quota by CLOSING the
     * socket, not by rejecting the promise. This used to leave a dead session
     * registered — `start()` resolved, the caller got a healthy-looking handle,
     * and `pushAudio` wrote into a closed socket and reported success.
     */
    it('fails the start when the server closes during connect', async () => {
      mockConnect.mockImplementationOnce((p: ConnectParams) => {
        const { socket, session } = makeSocket(p);
        socket.callbacks['onclose']!({ reason: 'invalid api key' });
        return Promise.resolve(session);
      });

      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'bad' });

      await expect(provider.start(params, events)).rejects.toThrow(
        /invalid api key/,
      );
      // Closed, not left dangling, and never announced through onClose — the
      // caller has no handle to attach that close to.
      expect(mockSockets[0]!.closes).toBe(1);
      expect(seen.closes).toEqual([]);
    });

    it('does not leak a session that failed to start', async () => {
      mockConnect.mockImplementationOnce((p: ConnectParams) => {
        const { socket, session } = makeSocket(p);
        socket.callbacks['onclose']!({ reason: 'quota' });
        return Promise.resolve(session);
      });
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await expect(provider.start(params, {})).rejects.toThrow(
        ProviderConnectionError,
      );

      // A later good session must be the ONLY one receiving audio; if the dead
      // entry had survived, it would still be holding its id in the map.
      const handle = await provider.start(params, {});
      await provider.pushAudio(handle, new Uint8Array([1]));
      expect(mockSockets[0]!.sent).toHaveLength(0);
      expect(mockSockets[1]!.sent).toHaveLength(1);
    });
  });

  describe('audio', () => {
    it('sends audio as base64 PCM at the input rate', async () => {
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const handle = await provider.start(params, {});
      await provider.pushAudio(handle, new Uint8Array([1, 2, 3, 4]));
      expect(mockSockets[0]!.sent).toEqual([
        {
          audio: {
            data: Buffer.from([1, 2, 3, 4]).toString('base64'),
            mimeType: 'audio/pcm;rate=16000',
          },
        },
      ]);
    });

    /**
     * The rate is READ from the mime type rather than assumed. Hardcoding 24000
     * would keep every byte assertion passing while playing audio at the wrong
     * speed — a defect no length check can see.
     */
    it('takes the output sample rate from the mime type', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, events);

      mockSockets[0]!.callbacks['onmessage']!(
        audioMessage(Buffer.from([9, 9]).toString('base64')),
      );
      mockSockets[0]!.callbacks['onmessage']!(
        audioMessage(
          Buffer.from([7]).toString('base64'),
          'audio/pcm;rate=16000',
        ),
      );

      expect(seen.audio).toEqual([
        [2, 24000],
        [1, 16000],
      ]);
    });

    it('reports an unreadable rate once per session, not once per chunk', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, events);

      for (let i = 0; i < 5; i += 1) {
        mockSockets[0]!.callbacks['onmessage']!(
          audioMessage('AAAA', 'audio/pcm'),
        );
      }

      // Audio arrives many times a second; an unlatched report would arrive at
      // that rate too and bury everything else the caller is being told.
      expect(seen.audio).toEqual([]);
      expect(seen.errors).toHaveLength(1);
      expect(seen.errors[0]).toContain('unreadable rate');
    });

    it('reports a send failure on the session instead of rejecting', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const handle = await provider.start(params, events);
      mockSockets[0]!.sendThrows = new Error('socket is closing');

      // Must not reject: the caller is an audio pump with nothing useful to do
      // with a rejected promise mid-utterance.
      await expect(
        provider.pushAudio(handle, new Uint8Array([1])),
      ).resolves.toBeUndefined();
      expect(seen.errors[0]).toContain('failed to send audio');
    });
  });

  describe('transcripts', () => {
    it('routes each transcript to its own channel, tagged with the DETECTED language', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, events);

      mockSockets[0]!.callbacks['onmessage']!({
        serverContent: {
          inputTranscription: { text: 'Tuy nhiên', languageCode: 'vi' },
          outputTranscription: { text: 'However', languageCode: 'en' },
        },
      });

      expect(seen.source).toEqual([['Tuy nhiên', 'vi']]);
      expect(seen.target).toEqual(['However']);
    });

    /**
     * The whole reason the detected language is surfaced: a caller can only
     * notice auto-detection failing if it is told what was heard, not what was
     * asked for.
     */
    it('reports a detected language that disagrees with the expected one', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, events);

      mockSockets[0]!.callbacks['onmessage']!({
        serverContent: {
          inputTranscription: { text: 'hello', languageCode: 'en' },
        },
      });

      expect(seen.source).toEqual([['hello', 'en']]);
      expect(seen.errors).toEqual([]);
      expect(seen.warnings).toEqual([]);
    });

    it('keeps the transcript but warns once when the tag is a third language', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, events);

      mockSockets[0]!.callbacks['onmessage']!({
        serverContent: {
          inputTranscription: { text: 'bonjour', languageCode: 'fr' },
        },
      });
      mockSockets[0]!.callbacks['onmessage']!({
        serverContent: {
          inputTranscription: { text: ' ça va', languageCode: 'fr' },
        },
      });

      // Delivered under the expected language — dropping it would lose the text
      // — but the tag we cannot model is announced rather than silently mapped.
      expect(seen.source).toEqual([
        ['bonjour', 'vi'],
        [' ça va', 'vi'],
      ]);
      expect(seen.warnings).toHaveLength(1);
      expect(seen.warnings[0]).toContain('fr');
      // On the warning channel and NOT the error one. The session is still
      // delivering both transcripts and its audio, and an error here reaches
      // the speaker as a failure banner that outlives the cause.
      expect(seen.errors).toEqual([]);
    });

    it('ignores messages that carry no serverContent', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, events);

      // Both shapes are real: the live API sends them alongside the content.
      mockSockets[0]!.callbacks['onmessage']!({
        usageMetadata: { totalTokenCount: 100 },
      });
      mockSockets[0]!.callbacks['onmessage']!({
        sessionResumptionUpdate: { resumable: true },
      });

      expect(seen).toMatchObject({
        source: [],
        target: [],
        audio: [],
        errors: [],
        warnings: [],
      });
    });

    it('contains a throwing consumer callback instead of letting it reach the socket', async () => {
      const errors: string[] = [];
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, {
        onSourceTranscript: () => {
          throw new Error('consumer blew up');
        },
        onError: (err) => errors.push(err.message),
      });

      // This runs inside the SDK's websocket handler; an escaping throw would
      // kill the socket rather than the caller.
      expect(() => {
        mockSockets[0]!.callbacks['onmessage']!({
          serverContent: {
            inputTranscription: { text: 'x', languageCode: 'vi' },
          },
        });
      }).not.toThrow();
      expect(errors).toEqual(['consumer blew up']);
    });
  });

  describe('lifecycle', () => {
    it('surfaces a socket error as ProviderConnectionError', async () => {
      const errors: Error[] = [];
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      await provider.start(params, { onError: (err) => errors.push(err) });

      mockSockets[0]!.callbacks['onerror']!({ message: 'upstream reset' });

      // Typed, so a caller can branch on transport failure the way it does for
      // every other provider in this package.
      expect(errors[0]).toBeInstanceOf(ProviderConnectionError);
      expect(errors[0]!.message).toBe('upstream reset');
    });

    it('surfaces a close and stops accepting audio for that handle', async () => {
      const { seen, events } = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const handle = await provider.start(params, events);

      mockSockets[0]!.callbacks['onclose']!({ reason: 'went away' });
      await provider.pushAudio(handle, new Uint8Array([1]));

      expect(seen.closes).toEqual(['went away']);
      expect(mockSockets[0]!.sent).toHaveLength(0);
    });

    it('closes the upstream session when the handle is closed', async () => {
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const handle = await provider.start(params, {});
      await handle.close();
      expect(mockSockets[0]!.closes).toBe(1);

      // Idempotent: a second close must not throw at a caller unwinding on error.
      await expect(handle.close()).resolves.toBeUndefined();
      expect(mockSockets[0]!.closes).toBe(1);
    });

    /**
     * What the continuous path will actually do. Handle ids used to be a
     * per-instance counter, so two providers both minted `gemini-live-0` and
     * audio could land in the wrong conversation.
     */
    it('keeps concurrent sessions independent', async () => {
      const a = recorder();
      const b = recorder();
      const provider = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const handleA = await provider.start(params, a.events);
      const handleB = await provider.start(
        { ...params, targetLanguage: 'vi' },
        b.events,
      );

      expect(handleA.id).not.toBe(handleB.id);

      await provider.pushAudio(handleA, new Uint8Array([1]));
      mockSockets[1]!.callbacks['onmessage']!({
        serverContent: { outputTranscription: { text: 'chỉ B' } },
      });

      expect(mockSockets[0]!.sent).toHaveLength(1);
      expect(mockSockets[1]!.sent).toHaveLength(0);
      expect(a.seen.target).toEqual([]);
      expect(b.seen.target).toEqual(['chỉ B']);

      // Closing one must leave the other usable.
      await handleA.close();
      await provider.pushAudio(handleB, new Uint8Array([2]));
      expect(mockSockets[1]!.sent).toHaveLength(1);
    });

    it('mints ids that do not collide across provider instances', async () => {
      const one = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const two = new GeminiLiveTranslateProvider({ apiKey: 'k' });
      const handleOne = await one.start(params, {});
      const handleTwo = await two.start(params, {});
      expect(handleOne.id).not.toBe(handleTwo.id);
    });
  });

  describe('registry wiring', () => {
    it('resolves through the composition root, and refuses an unknown name', () => {
      const registry = registerDefaultProviders(new ProviderRegistry());
      expect(registry.list('realtime')).toContain('gemini-live');
      expect(
        registry.resolve('realtime', 'gemini-live', { geminiApiKey: 'k' }).name,
      ).toBe('gemini-live');
      expect(() =>
        registry.resolve('realtime', 'nope', { geminiApiKey: 'k' }),
      ).toThrow();
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import type { AudioFrame, ServerEvent } from '@chatofy/types';
import { MAX_SAMPLE_RATE } from '@chatofy/types';
import {
  TranslationSessionService,
  type StreamSocket,
} from './translation-session.service';
import type {
  PipelineTranslatorService,
  SynthesizeRequest,
  TranslateTurnInput,
} from './pipeline-translator.service';
import type { TurnMetrics, TurnMetricsRecorder } from './turn-metrics.recorder';
import { encodePcm16Wav } from '../audio/wav-codec';

const SAMPLE_RATE = 16000;
const TTS_SAMPLE_RATE = 24000;

/** Collects everything the service pushed, already parsed back into events. */
class FakeSocket implements StreamSocket {
  readonly events: ServerEvent[] = [];

  send(data: string): void {
    this.events.push(JSON.parse(data) as ServerEvent);
  }

  ofType<T extends ServerEvent['type']>(
    type: T,
  ): Extract<ServerEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<
      ServerEvent,
      { type: T }
    >[];
  }

  get first(): ServerEvent | undefined {
    return this.events[0];
  }
}

/** WAV of `ms` milliseconds, as the TTS sidecar would return it. */
const ttsWav = (ms: number): Uint8Array =>
  new Uint8Array(
    encodePcm16Wav({
      samples: Buffer.alloc(Math.round((TTS_SAMPLE_RATE * ms) / 1000) * 2),
      sampleRate: TTS_SAMPLE_RATE,
      channels: 1,
    }),
  );

interface Harness {
  service: TranslationSessionService;
  transcribe: jest.Mock;
  translate: jest.Mock;
  transcribeAndTranslate: jest.Mock;
  synthesize: jest.Mock;
  /** Text handed to each synthesis call, in order. */
  synthesized: string[];
  recorded: TurnMetrics[];
}

function makeService(overrides: Partial<Harness> = {}): Harness {
  const synthesized: string[] = [];
  const recorded: TurnMetrics[] = [];

  const transcribeAndTranslate =
    overrides.transcribeAndTranslate ??
    jest.fn().mockResolvedValue({
      sourceText: 'xin chào',
      targetText: 'hello',
      targetLanguage: 'en',
    });

  const synthesize =
    overrides.synthesize ??
    jest.fn((req: SynthesizeRequest) => {
      synthesized.push(req.text);
      // 1s per clause — five 200ms frames, so frame counts stay easy to read.
      return Promise.resolve({ bytes: ttsWav(1000), mimeType: 'audio/wav' });
    });

  const transcribe = overrides.transcribe ?? jest.fn().mockResolvedValue('xin');
  const translate = overrides.translate ?? jest.fn().mockResolvedValue('hi');

  const pipeline = {
    transcribe,
    translate,
    transcribeAndTranslate,
    synthesize,
  } as unknown as PipelineTranslatorService;
  const metrics = {
    record: (m: TurnMetrics) => recorded.push(m),
  } as unknown as TurnMetricsRecorder;

  return {
    service: new TranslationSessionService(pipeline, metrics),
    transcribe,
    translate,
    transcribeAndTranslate,
    synthesize,
    synthesized,
    recorded,
  };
}

const frame = (
  overrides: Partial<AudioFrame> & { sessionId: string },
): AudioFrame => ({
  encoding: 'pcm16',
  sampleRate: SAMPLE_RATE,
  sequence: 0,
  timestamp: 0,
  // 100ms of silence — content is irrelevant, the pipeline is faked.
  payload: Buffer.alloc(SAMPLE_RATE / 10 / 2).toString('base64'),
  ...overrides,
});

/** Open a turn and return the id the server assigned it. */
function open(service: TranslationSessionService, socket: FakeSocket): string {
  service.start(socket, 'vi_to_en');
  const ready = socket.ofType('server.session.ready')[0];
  if (!ready) throw new Error('server.session.ready was never sent');
  return ready.sessionId;
}

describe('TranslationSessionService', () => {
  it('answers session.start with a session id', () => {
    const { service } = makeService();
    const socket = new FakeSocket();

    const sessionId = open(service, socket);
    expect(sessionId).toEqual(expect.any(String));
    expect(socket.events).toHaveLength(1);
  });

  it('runs the turn and streams transcript then audio then ended', async () => {
    const { service } = makeService();
    const socket = new FakeSocket();
    const sessionId = open(service, socket);

    service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
    service.pushFrame(socket, frame({ sessionId, sequence: 1 }));
    await service.end(socket);

    expect(socket.events.map((e) => e.type)).toEqual([
      'server.session.ready',
      'server.transcript.final',
      ...Array<string>(5).fill('server.audio.frame'), // 1s at 200ms per frame
      'server.session.ended',
    ]);

    const [segment] = socket.ofType('server.transcript.final');
    expect(segment?.segment).toMatchObject({
      sessionId,
      direction: 'vi_to_en',
      speakerRole: 'speaker_a',
      sourceText: 'xin chào',
      targetText: 'hello',
      audioUrl: null,
    });
  });

  // PyAV opens a container, so headerless frames would fail to decode.
  it('hands the pipeline a WAV built from the buffered frames', async () => {
    const seen: TranslateTurnInput[] = [];
    const { service } = makeService({
      transcribeAndTranslate: jest.fn((input: TranslateTurnInput) => {
        seen.push(input);
        return Promise.resolve({
          sourceText: 'xin chào',
          targetText: 'hello',
          targetLanguage: 'en' as const,
        });
      }),
    });
    const socket = new FakeSocket();
    const sessionId = open(service, socket);

    service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
    await service.end(socket);

    const input = seen[0];
    expect(input).toBeDefined();
    expect(input?.mimeType).toBe('audio/wav');
    expect(input?.direction).toBe('vi_to_en');

    const wav = Buffer.from(input!.audio);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
  });

  it('emits outbound audio as raw pcm16 with an advancing sequence', async () => {
    const { service } = makeService();
    const socket = new FakeSocket();
    const sessionId = open(service, socket);
    service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
    await service.end(socket);

    const frames = socket.ofType('server.audio.frame').map((e) => e.frame);
    expect(frames.map((f) => f.sequence)).toEqual([0, 1, 2, 3, 4]);
    for (const f of frames) {
      expect(f.encoding).toBe('pcm16');
      expect(f.sampleRate).toBe(TTS_SAMPLE_RATE); // the TTS rate, not the mic rate
      expect(f.sessionId).toBe(sessionId);
    }
    // 200ms of 24 kHz mono 16-bit.
    expect(Buffer.from(frames[0]!.payload, 'base64')).toHaveLength(9600);
  });

  // The measured reason the streaming path exists: audio starts at the first
  // comma instead of the final full stop.
  describe('clause-by-clause synthesis', () => {
    it('synthesizes each clause separately and in order', async () => {
      const { service, synthesized, synthesize } = makeService({
        transcribeAndTranslate: jest.fn().mockResolvedValue({
          sourceText: 'xin chào, cái này giá bao nhiêu?',
          targetText: 'Hello, how much does this cost?',
          targetLanguage: 'en',
        }),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(synthesized).toEqual(['Hello,', 'how much does this cost?']);
      expect(synthesize).toHaveBeenCalledTimes(2);
    });

    it('pushes the first clause audio before the second is synthesized', async () => {
      // Ordering is the whole point: if the service gathered every clause up
      // front, nothing would reach the client until the last one was done.
      const order: string[] = [];
      const { service } = makeService({
        transcribeAndTranslate: jest.fn().mockResolvedValue({
          sourceText: 'a',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: jest.fn((req: SynthesizeRequest) => {
          order.push(`synthesize:${req.text}`);
          return Promise.resolve({ bytes: ttsWav(200), mimeType: 'audio/wav' });
        }),
      });
      // Records when audio reaches the wire, interleaved with the synthesis
      // calls above, so the two orderings can be compared directly.
      class OrderedSocket extends FakeSocket {
        override send(data: string): void {
          const event = JSON.parse(data) as ServerEvent;
          if (event.type === 'server.audio.frame') order.push('audio');
          super.send(data);
        }
      }

      const socket = new OrderedSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(order).toEqual([
        'synthesize:Hello,',
        'audio',
        'synthesize:how are you?',
        'audio',
      ]);
    });

    it('numbers audio frames continuously across clauses', async () => {
      const { service } = makeService({
        transcribeAndTranslate: jest.fn().mockResolvedValue({
          sourceText: 'a',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      const sequences = socket
        .ofType('server.audio.frame')
        .map((e) => e.frame.sequence);
      expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
      expect(new Set(sequences).size).toBe(sequences.length);
    });
  });

  // Starting the text half early is worth ~350ms of the latency budget.
  //
  // These tests pass whether or not the saving is real, and for a while it was
  // not: they describe a server that reuses its early work when the byte count
  // has not moved, which it does, while the client streamed the silence after
  // every utterance and moved it on every turn. Passing here says nothing about
  // that. The half that decides it is `sends nothing once the end is
  // suspected` in `apps/web/src/audio/capture-pump.spec.ts` — if that one goes,
  // these keep passing and the saving quietly disappears again.
  describe('speculation', () => {
    it('reuses speculated work when no more audio arrived', async () => {
      const { service, transcribeAndTranslate, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      service.speculate(socket);
      await service.end(socket);

      expect(transcribeAndTranslate).toHaveBeenCalledTimes(1);
      expect(recorded[0]?.speculationUsed).toBe(true);
    });

    it('discards speculated work when the speaker carried on', async () => {
      const { service, transcribeAndTranslate, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));

      service.speculate(socket);
      // More speech: the speculation transcribed a different utterance, and no
      // later pause replaced it.
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));
      await service.end(socket);

      expect(transcribeAndTranslate).toHaveBeenCalledTimes(2);
      expect(recorded[0]?.speculationUsed).toBe(false);
    });

    // The case a single guess per turn could never win: the speaker pauses,
    // carries on, then stops. The first guess is stale by then; the second is
    // the one the endpoint can use.
    it('renews the guess at a later pause, so a turn with two pauses still lands', async () => {
      const { service, transcribeAndTranslate, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
      service.speculate(socket); // pause one — superseded below
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));
      service.speculate(socket); // pause two — this is the one that holds
      await service.end(socket);

      expect(recorded[0]?.speculationUsed).toBe(true);
      expect(recorded[0]?.speculations).toBe(2);
      // Two guesses, no third call at the endpoint: the second was reused.
      expect(transcribeAndTranslate).toHaveBeenCalledTimes(2);
    });

    // Measured before the ladders were split: speculative traffic pushed the
    // shared one past its per-minute ceiling and two live turns fell through to
    // a model that took ten and eighteen seconds. Guesses and endings must not
    // compete for the same model's quota, and neither may reach the slow one.
    it('keeps guesses off the model the ending depends on, and both off the slow one', async () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
      service.speculate(socket);
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));
      await service.end(socket);

      const [guess, ending] = (
        transcribeAndTranslate.mock.calls as Array<[{ models?: string[] }]>
      ).map(([input]) => input.models);
      expect(guess?.[0]).not.toBe(ending?.[0]);
      for (const ladder of [guess, ending]) {
        expect(ladder?.length).toBeGreaterThan(0);
        expect(ladder?.some((model) => model.includes('gemma'))).toBe(false);
      }
    });

    it('does not spend a second request on audio that has not changed', () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      service.speculate(socket);
      service.speculate(socket);
      service.speculate(socket);

      expect(transcribeAndTranslate).toHaveBeenCalledTimes(1);
    });

    // Each guess is a translation request against a per-model per-minute
    // ceiling, so a client that suspects the end constantly must not be able to
    // spend the quota of one that talks normally.
    it('stops guessing once a turn has spent its cap', () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      // Each pause preceded by new audio, so nothing is skipped as unchanged.
      for (let sequence = 0; sequence < 10; sequence += 1) {
        service.pushFrame(socket, frame({ sessionId, sequence }));
        service.speculate(socket);
      }

      expect(transcribeAndTranslate).toHaveBeenCalledTimes(4);
    });

    it('ignores speculation before any audio arrived', () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      open(service, socket);

      service.speculate(socket);

      expect(transcribeAndTranslate).not.toHaveBeenCalled();
      expect(socket.ofType('server.error')).toHaveLength(0);
    });

    it('does not surface a discarded speculation failure', async () => {
      // An unobserved rejection would take the process down, and the turn that
      // replaced it succeeded — the client must not hear about the guess.
      const failing = jest
        .fn()
        .mockRejectedValueOnce(new Error('speculation blew up'))
        .mockResolvedValue({
          sourceText: 'xin chào',
          targetText: 'hello',
          targetLanguage: 'en',
        });
      const { service } = makeService({ transcribeAndTranslate: failing });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));

      service.speculate(socket);
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));
      await service.end(socket);

      expect(socket.ofType('server.error')).toHaveLength(0);
      expect(socket.ofType('server.session.ended')[0]?.reason).toBe(
        'completed',
      );
    });
  });

  // The point of the feature: something on screen while the sentence is still
  // being said, rather than a still page and then everything at once.
  describe('live transcript', () => {
    /** Let the fire-and-forget read settle without reaching for timers. */
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    it('shows what has been said so far, while the turn is still open', async () => {
      const { service, transcribe } = makeService({
        transcribe: jest.fn().mockResolvedValue('xin chào tôi muốn'),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId }));
      await settle();

      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(socket.ofType('server.transcript.partial')[0]).toMatchObject({
        text: 'xin chào tôi muốn',
        speaker: 'speaker_a',
        direction: 'vi_to_en',
      });
    });

    // A read that lands after the turn has been answered would put a half
    // sentence back on screen underneath the finished translation.
    it('says nothing once the turn has moved on', async () => {
      let release!: (text: string) => void;
      const transcribe = jest.fn(
        () => new Promise<string>((resolve) => (release = resolve)),
      );
      const { service } = makeService({ transcribe });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId }));
      await service.end(socket);
      release('xin chào');
      await settle();

      expect(socket.ofType('server.transcript.partial')).toHaveLength(0);
    });

    // The live transcript is a courtesy; the turn is answered by `end()` either
    // way. A recogniser that stumbles must not interrupt someone mid-sentence.
    it('keeps a failed read to itself', async () => {
      const { service } = makeService({
        transcribe: jest.fn().mockRejectedValue(new Error('sidecar down')),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId }));
      await settle();

      expect(socket.ofType('server.error')).toHaveLength(0);
      expect(socket.ofType('server.transcript.partial')).toHaveLength(0);
    });

    it('stays quiet when the recogniser heard nothing yet', async () => {
      const { service } = makeService({
        transcribe: jest.fn().mockResolvedValue('   '),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId }));
      await settle();

      expect(socket.ofType('server.transcript.partial')).toHaveLength(0);
    });

    // A client that leaves mid-sentence stops sending frames, and the reading
    // stops with it — there is no timer left running over a dead session.
    it('reads nothing more once the client has gone', async () => {
      const { service, transcribe } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
      await settle();
      const readsBefore = transcribe.mock.calls.length;

      service.disconnect(socket);
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));
      await settle();

      expect(transcribe.mock.calls.length).toBe(readsBefore);
    });
  });

  // Long turns only: a short one has its real translation on screen sooner
  // than a guess would be worth reading, and each guess is a metered request.
  describe('live translation', () => {
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    /** Frame carrying `seconds` of 16 kHz mono PCM16. */
    const secondsOfAudio = (sessionId: string, seconds: number, sequence = 0) =>
      frame({
        sessionId,
        sequence,
        payload: Buffer.alloc(SAMPLE_RATE * 2 * seconds).toString('base64'),
      });

    it('translates a turn that has run long enough to be worth guessing at', async () => {
      const { service, translate } = makeService({
        transcribe: jest.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: jest.fn().mockResolvedValue('yesterday I booked a room'),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, secondsOfAudio(sessionId, 5));
      await settle();
      await settle();

      expect(translate).toHaveBeenCalledTimes(1);
      expect(socket.ofType('server.translation.partial')[0]).toMatchObject({
        text: 'yesterday I booked a room',
        direction: 'vi_to_en',
      });
    });

    it('leaves a short turn to its own ending', async () => {
      const { service, translate } = makeService({
        transcribe: jest.fn().mockResolvedValue('xin chào'),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, secondsOfAudio(sessionId, 1));
      await settle();
      await settle();

      expect(translate).not.toHaveBeenCalled();
      expect(socket.ofType('server.translation.partial')).toHaveLength(0);
    });

    // The sentence is unfinished, so the guess can be wrong. Wrong text is
    // replaced silently; wrong speech cannot be taken back.
    it('never speaks a guess aloud', async () => {
      const { service, synthesize } = makeService({
        transcribe: jest.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: jest.fn().mockResolvedValue('yesterday I booked a room'),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, secondsOfAudio(sessionId, 5));
      await settle();
      await settle();

      expect(synthesize).not.toHaveBeenCalled();
      expect(socket.ofType('server.audio.frame')).toHaveLength(0);
    });

    // Its model has no fallback by design: a rate limit here must cost the
    // guess, never the answer the speaker is waiting for.
    it('says nothing when its model is unavailable', async () => {
      const { service } = makeService({
        transcribe: jest.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: jest.fn().mockRejectedValue(new Error('rate limited')),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, secondsOfAudio(sessionId, 5));
      await settle();
      await settle();

      expect(socket.ofType('server.error')).toHaveLength(0);
      expect(socket.ofType('server.translation.partial')).toHaveLength(0);
    });

    it('keeps guesses off the model the ending depends on', async () => {
      const { service, translate } = makeService({
        transcribe: jest.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: jest.fn().mockResolvedValue('yesterday'),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, secondsOfAudio(sessionId, 5));
      await settle();
      await settle();

      const [request] = translate.mock.calls[0] as [{ models?: string[] }];
      expect(request.models).toEqual(['gemini-3.5-flash-lite']);
    });
  });

  describe('turn metrics', () => {
    it('records the timings a latency table is built from', async () => {
      const { service, recorded } = makeService({
        transcribeAndTranslate: jest.fn().mockResolvedValue({
          sourceText: 'xin chào',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        sessionId,
        direction: 'vi_to_en',
        inputSampleRate: SAMPLE_RATE,
        targetChars: 'Hello, how are you?'.length,
        clauses: 2,
        speculationUsed: false,
      });
      expect(recorded[0]?.firstAudioAtMs).toBeGreaterThanOrEqual(
        recorded[0]!.translatedAtMs,
      );
      expect(recorded[0]?.lastAudioAtMs).toBeGreaterThanOrEqual(
        recorded[0]!.firstAudioAtMs,
      );
    });

    // A table built only from successes cannot tell "no failures" from
    // "failures never written down".
    it('records a failed turn too, flagged as incomplete', async () => {
      const { service, recorded } = makeService({
        transcribeAndTranslate: jest
          .fn()
          .mockRejectedValue(new BadRequestException('No speech detected')),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ completed: false, clauses: 0 });
    });

    it('flags a completed turn', async () => {
      const { service, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(recorded[0]?.completed).toBe(true);
    });

    // The head start showed up in firstAudioAtMs while the requests that bought
    // it sat in no column at all. A saving reported without its bill is the one
    // number a latency table must not print.
    it('bills the turn for the live translations it spent', async () => {
      const settle = () => new Promise((resolve) => setImmediate(resolve));
      const { service, recorded, translate } = makeService({
        transcribe: jest.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: jest.fn().mockResolvedValue('yesterday I booked a room'),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      // Five seconds of speech is past the threshold a live translation needs.
      service.pushFrame(
        socket,
        frame({
          sessionId,
          payload: Buffer.alloc(SAMPLE_RATE * 2 * 5).toString('base64'),
        }),
      );
      await settle();
      await settle();
      expect(translate).toHaveBeenCalledTimes(1);

      await service.end(socket);

      expect(recorded[0]?.liveTranslations).toBe(1);
    });

    // The verdict is taken before the pipeline is awaited, so a turn that dies
    // in the await still reports it. Marking it afterwards instead reads as
    // "this turn never used a guess" on exactly the turns that did.
    it('reports a reused guess even when that guess is what failed', async () => {
      const { service, recorded } = makeService({
        transcribeAndTranslate: jest
          .fn()
          .mockRejectedValue(new BadRequestException('No speech detected')),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      service.speculate(socket); // the guess is in flight, and will reject
      await service.end(socket); // and no further audio arrived, so it is reused

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        completed: false,
        speculationUsed: true,
      });
    });

    it('bills nothing to a turn too short to guess at', async () => {
      const { service, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(recorded[0]?.liveTranslations).toBe(0);
    });
  });

  describe('rejects what would corrupt the turn', () => {
    it('refuses a frame before session.start', () => {
      const { service } = makeService();
      const socket = new FakeSocket();

      service.pushFrame(socket, frame({ sessionId: 'ghost' }));
      expect(socket.first).toMatchObject({
        type: 'server.error',
        code: 'no_active_session',
      });
    });

    it('refuses a frame carrying another session id', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      open(service, socket);

      service.pushFrame(socket, frame({ sessionId: 'somebody-else' }));
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'frame_rejected',
      });
    });

    // Gaps are legitimate once the client gates on voice activity; a sequence
    // that fails to advance means a replayed or reordered frame.
    it('refuses a frame whose sequence does not advance', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, sequence: 5 }));
      service.pushFrame(socket, frame({ sessionId, sequence: 5 }));
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'frame_rejected',
      });
    });

    it('accepts a sequence gap left by voice-activity gating', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
      service.pushFrame(socket, frame({ sessionId, sequence: 40 }));
      expect(socket.ofType('server.error')).toHaveLength(0);
    });

    it('refuses a frame whose sample rate changed mid-turn', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
      service.pushFrame(
        socket,
        frame({ sessionId, sequence: 1, sampleRate: 48000 }),
      );
      expect(socket.ofType('server.error')[0]?.message).toMatch(/sample rate/);
    });

    it('refuses a turn that carried no audio', async () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      open(service, socket);

      await service.end(socket);
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'no_audio',
      });
      expect(transcribeAndTranslate).not.toHaveBeenCalled();
    });

    it('refuses session.end with no turn open', async () => {
      const { service } = makeService();
      const socket = new FakeSocket();

      await service.end(socket);
      expect(socket.first).toMatchObject({ code: 'no_active_session' });
    });
  });

  describe('failure handling', () => {
    it('reports the pipeline message and closes the turn', async () => {
      const { service } = makeService({
        transcribeAndTranslate: jest
          .fn()
          .mockRejectedValue(new BadRequestException('No speech detected')),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'turn_failed',
        message: 'No speech detected',
      });
      expect(socket.ofType('server.session.ended')[0]?.reason).toBe('error');
    });

    // The ElevenLabs backend returns audio/mpeg, which cannot be framed as raw
    // samples — saying so beats sending frames the client decodes as noise.
    it('reports a TTS backend whose output is not PCM WAV', async () => {
      const { service, synthesize } = makeService({
        transcribeAndTranslate: jest.fn().mockResolvedValue({
          sourceText: 'xin chào',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: jest.fn().mockResolvedValue({
          bytes: new Uint8Array(Buffer.from('ID3 mp3 payload')),
          mimeType: 'audio/mpeg',
        }),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(socket.ofType('server.audio.frame')).toHaveLength(0);
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'unsupported_audio',
      });
      // Stops at the first unusable clause rather than reporting once per clause.
      expect(synthesize).toHaveBeenCalledTimes(1);
      // The transcript still went out — only the audio could not be framed.
      expect(socket.ofType('server.transcript.final')).toHaveLength(1);
    });
  });

  // Replacing a turn mid-translation would leave the in-flight end() holding the
  // old session and finishing by deleting the new one.
  it('refuses to open a turn while one is being translated', async () => {
    let release: (() => void) | undefined;
    const { service } = makeService({
      transcribeAndTranslate: jest.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                sourceText: 'xin chào',
                targetText: 'hello',
                targetLanguage: 'en',
              });
          }),
      ),
    });
    const socket = new FakeSocket();
    const sessionId = open(service, socket);
    service.pushFrame(socket, frame({ sessionId }));

    const turn = service.end(socket);
    service.start(socket, 'vi_to_en'); // the client tries to barge in

    expect(socket.ofType('server.error')[0]).toMatchObject({
      code: 'session_busy',
    });
    expect(socket.ofType('server.session.ready')).toHaveLength(1);

    release?.();
    await turn;
    expect(socket.ofType('server.session.ended')[0]?.reason).toBe('completed');
  });

  // Finishing a turn for a client that left costs real translation quota and
  // writes to a closed socket.
  it('abandons a turn whose socket disconnected while translating', async () => {
    let release: (() => void) | undefined;
    const { service, synthesize, recorded } = makeService({
      transcribeAndTranslate: jest.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                sourceText: 'xin chào',
                targetText: 'Hello, how are you?',
                targetLanguage: 'en',
              });
          }),
      ),
    });
    const socket = new FakeSocket();
    const sessionId = open(service, socket);
    service.pushFrame(socket, frame({ sessionId }));

    const turn = service.end(socket);
    service.disconnect(socket);
    release?.();
    await turn;

    expect(synthesize).not.toHaveBeenCalled();
    expect(socket.ofType('server.transcript.final')).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  it('forgets a socket that dropped mid-turn', async () => {
    const { service } = makeService();
    const socket = new FakeSocket();
    const sessionId = open(service, socket);
    service.pushFrame(socket, frame({ sessionId }));

    service.disconnect(socket);
    await service.end(socket);

    expect(socket.ofType('server.error')[0]).toMatchObject({
      code: 'no_active_session',
    });
  });

  // Everything above drives the service through its public API and passes
  // whether or not several of its guards exist. Each test below was written
  // against a build with the matching guard deleted, and seen to fail there
  // first — a guard nothing can fail over is a guard the next refactor removes.
  describe('guards no other test would miss', () => {
    /** Let a fire-and-forget read settle without reaching for timers. */
    const settle = () => new Promise((resolve) => setImmediate(resolve));

    /**
     * Sized from the contract's ceiling rather than the rate the frame reports,
     * exactly as the service does — a cap scaled by a client-supplied number is
     * not a cap.
     */
    const MAX_TURN_BYTES = MAX_SAMPLE_RATE * 1 * 2 * 60;

    it('ends an over-long turn AND forgets it', async () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(
        socket,
        frame({
          sessionId,
          payload: Buffer.alloc(MAX_TURN_BYTES + 2).toString('base64'),
        }),
      );

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'turn_too_long',
      });
      expect(socket.ofType('server.session.ended')[0]?.reason).toBe(
        'turn_too_long',
      );

      // The registry entry has to go with the event. Reporting the cap while
      // still holding the turn would keep 5.76MB alive and leave the client
      // able to run the whole pipeline on it afterwards.
      await service.end(socket);
      expect(socket.ofType('server.error')[1]).toMatchObject({
        code: 'no_active_session',
      });
    });

    it('refuses a frame that arrives after the turn started translating', async () => {
      let release: (() => void) | undefined;
      const { service, transcribe } = makeService({
        transcribeAndTranslate: jest.fn(
          () =>
            new Promise((resolve) => {
              release = () =>
                resolve({
                  sourceText: 'xin chào',
                  targetText: 'hello',
                  targetLanguage: 'en',
                });
            }),
        ),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
      const readsBefore = transcribe.mock.calls.length;

      const turn = service.end(socket); // the turn is now translating
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'session_busy',
      });
      // Appending here would grow the buffer the endpoint is already reading.
      expect(transcribe.mock.calls.length).toBe(readsBefore);

      release?.();
      await turn;
    });

    it('refuses a frame in an encoding this path cannot decode', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, encoding: 'opus' }));

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'unsupported_audio',
      });
    });

    // The turn may end, or the client may leave, while a decode is in the air.
    // `says nothing once the turn has moved on` covers the first; nothing
    // covered the second, and the two are caught by different guards.
    it('emits no partial transcript for a client that left mid-decode', async () => {
      let release!: (text: string) => void;
      const transcribe = jest.fn(
        () => new Promise<string>((resolve) => (release = resolve)),
      );
      const { service } = makeService({ transcribe });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId }));
      expect(transcribe).toHaveBeenCalledTimes(1);

      service.disconnect(socket);
      release('xin chào');
      await settle();

      expect(socket.ofType('server.transcript.partial')).toHaveLength(0);
    });

    it('emits no live translation for a client that left mid-request', async () => {
      let release!: (text: string) => void;
      const { service, translate } = makeService({
        transcribe: jest.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: jest.fn(
          () => new Promise<string>((resolve) => (release = resolve)),
        ),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(
        socket,
        frame({
          sessionId,
          payload: Buffer.alloc(SAMPLE_RATE * 2 * 5).toString('base64'),
        }),
      );
      await settle();
      expect(translate).toHaveBeenCalledTimes(1); // it really is in flight

      service.disconnect(socket);
      release('yesterday I booked a room');
      await settle();

      expect(socket.ofType('server.translation.partial')).toHaveLength(0);
    });

    it('stops synthesizing clauses once the client has gone', async () => {
      const spoken: string[] = [];
      const { service } = makeService({
        transcribeAndTranslate: jest.fn().mockResolvedValue({
          sourceText: 'a',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: jest.fn((req: SynthesizeRequest) => {
          spoken.push(req.text);
          // The client goes while the first clause is being synthesized.
          service.disconnect(socket);
          return Promise.resolve({ bytes: ttsWav(200), mimeType: 'audio/wav' });
        }),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      // Two clauses were split; only the first should have cost any CPU.
      expect(spoken).toEqual(['Hello,']);
    });

    // `payload` is a plain string in the contract, and the turn's sample rate is
    // fixed by the first frame regardless of how many bytes it carried — so a
    // buffer can exist while holding nothing. "Has audio" has to mean bytes.
    it('treats a frame carrying no bytes as no audio at all', async () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.pushFrame(socket, frame({ sessionId, payload: '' }));

      // Guessing here would spend requests transcribing a bare WAV header.
      service.speculate(socket);
      expect(transcribeAndTranslate).not.toHaveBeenCalled();

      await service.end(socket);
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'no_audio',
      });
    });

    // A conversation is many turns over one socket, which no other test walks.
    it('opens a second turn on the same socket once the first completed', async () => {
      const { service } = makeService();
      const socket = new FakeSocket();

      const first = open(service, socket);
      service.pushFrame(socket, frame({ sessionId: first }));
      await service.end(socket);

      service.start(socket, 'vi_to_en');

      const ready = socket.ofType('server.session.ready');
      expect(ready).toHaveLength(2);
      expect(ready[1]?.sessionId).not.toBe(first);
      expect(socket.ofType('server.error')).toHaveLength(0);
    });
  });
});

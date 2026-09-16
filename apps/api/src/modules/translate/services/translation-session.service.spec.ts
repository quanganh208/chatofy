import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
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
import type { ClientTurnMetrics } from '@chatofy/types';
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
  transcribe: Mock;
  translate: Mock;
  transcribeAndTranslate: Mock;
  embedSpeaker: Mock;
  synthesize: Mock;
  /** Text handed to each synthesis call, in order. */
  synthesized: string[];
  recorded: TurnMetrics[];
  /** Rows the client filed, which the server only relays. */
  recordedClient: ClientTurnMetrics[];
}

function makeService(
  overrides: Partial<Harness> = {},
  // Off is the shipped default and what every test above assumes: those turns
  // must behave exactly as they did before the flag existed.
  speakerEmbeddingEnabled = false,
): Harness {
  const synthesized: string[] = [];
  const recorded: TurnMetrics[] = [];
  const recordedClient: ClientTurnMetrics[] = [];

  const transcribeAndTranslate =
    overrides.transcribeAndTranslate ??
    vi.fn().mockResolvedValue({
      sourceText: 'xin chào',
      targetText: 'hello',
      targetLanguage: 'en',
    });

  const synthesize =
    overrides.synthesize ??
    vi.fn((req: SynthesizeRequest) => {
      synthesized.push(req.text);
      // 1s per clause — five 200ms frames, so frame counts stay easy to read.
      return Promise.resolve({ bytes: ttsWav(1000), mimeType: 'audio/wav' });
    });

  const embedSpeaker =
    overrides.embedSpeaker ?? vi.fn().mockResolvedValue([0.6, 0.8]);

  const transcribe = overrides.transcribe ?? vi.fn().mockResolvedValue('xin');
  const translate = overrides.translate ?? vi.fn().mockResolvedValue('hi');

  const pipeline = {
    transcribe,
    translate,
    transcribeAndTranslate,
    embedSpeaker,
    synthesize,
  } as unknown as PipelineTranslatorService;
  const metrics = {
    record: (m: TurnMetrics) => recorded.push(m),
    recordClient: (m: ClientTurnMetrics) => recordedClient.push(m),
  } as unknown as TurnMetricsRecorder;

  return {
    // Speaker embedding off, which is the shipped default. The turns these
    // tests drive must behave exactly as they did before the flag existed.
    service: new TranslationSessionService(pipeline, metrics, {
      // Key-aware, because the service now reads numbers as well as the flag.
      // A mock that answers every key with a boolean gave the budget a ceiling
      // of `false`, and a budget with a ceiling of `false` refuses everything —
      // silently, since refusing is a legitimate answer.
      get: (key: string) =>
        key === 'LIVE_TRANSLATION_RPM'
          ? 66
          : key === 'LIVE_TRANSLATION_COMMIT_CHARS'
            ? 15
            : speakerEmbeddingEnabled,
    } as unknown as ConfigService<Env, true>),
    transcribe,
    translate,
    transcribeAndTranslate,
    embedSpeaker,
    synthesize,
    synthesized,
    recorded,
    recordedClient,
  };
}

/** A plausible client row; individual tests override what they care about. */
const clientMetrics = (
  sessionId: string,
  overrides: Partial<ClientTurnMetrics> = {},
): ClientTurnMetrics => ({
  sessionId,
  speechStartedAt: 1_760_000_000_000,
  speechEndedAt: 1_760_000_008_000,
  capturedMs: 7800,
  heldMs: 200,
  cutForced: false,
  outcome: 'played',
  echoEvents: 0,
  ...overrides,
});

const frame = (
  overrides: Partial<AudioFrame> & { sessionId: string },
): AudioFrame => ({
  encoding: 'pcm16',
  sampleRate: SAMPLE_RATE,
  sequence: 0,
  timestamp: 0,
  // 320ms of silence: content is irrelevant against a faked pipeline, but the
  // duration is not. It matches the pre-roll a real client opens a turn with,
  // and a turn opening on less than the recogniser's floor takes a path — no
  // live transcript at all — that no caller can reach.
  //
  // The value this replaced claimed 100ms in a comment and allocated 25ms, and
  // the tests below asserted a live transcript on it for as long as the
  // recogniser was a mock that would decode anything.
  payload: Buffer.alloc(Math.round(SAMPLE_RATE * 2 * 0.32)).toString('base64'),
  ...overrides,
});

/**
 * Open a turn and return the id the server assigned it.
 *
 * Reads the NEWEST `ready` rather than the first. A socket may hold several turns
 * now, so taking `[0]` would hand every caller the id of the turn opened first and
 * quietly make each concurrency test operate on one turn.
 */
function open(
  service: TranslationSessionService,
  socket: FakeSocket,
  turnId?: string,
  /** What the web client sends; absent is the extension and mobile today. */
  streamCommitted?: boolean,
): string {
  const before = socket.ofType('server.session.ready').length;
  service.start(
    socket,
    { direction: 'vi_to_en', voiceGender: 'female', streamCommitted },
    turnId,
  );
  const ready = socket.ofType('server.session.ready').at(-1);
  if (!ready || socket.ofType('server.session.ready').length === before) {
    throw new Error('server.session.ready was never sent');
  }
  return ready.sessionId;
}

/** Lets queued promise callbacks run without waiting on a timer. */
const settleMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Opens a turn and gives it TWO reads of growing audio, then returns its id.
 *
 * Two, because a mid-sentence translation now follows settled text, and text
 * settles only where two consecutive reads agree — one read settles nothing and
 * is worth no request. Tests written against the old policy pushed a single
 * frame and expected a guess; they were measuring seconds of speech, and the
 * unit is now characters that have stopped moving.
 *
 * Three seconds a side keeps the turn inside the nine-second read window, which
 * is what makes two reads comparable at all. And the clock is installed BEFORE
 * the turn is opened on purpose: the read scheduler captures the `Date.now`
 * function when it is constructed, so a spy installed later is held by nobody.
 */
async function openTurnWithTwoReads(
  service: TranslationSessionService,
  socket: FakeSocket,
  streamCommitted?: boolean,
): Promise<string> {
  let clock = 1_000_000;
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
  try {
    const sessionId = open(service, socket, undefined, streamCommitted);
    const read = (sequence: number) =>
      frame({
        sessionId,
        sequence,
        payload: Buffer.alloc(SAMPLE_RATE * 2 * 3).toString('base64'),
      });
    service.pushFrame(socket, read(0));
    await settleMicrotasks();
    await settleMicrotasks();
    clock += 1_000;
    service.pushFrame(socket, read(1));
    await settleMicrotasks();
    await settleMicrotasks();
    return sessionId;
  } finally {
    spy.mockRestore();
  }
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
      transcribeAndTranslate: vi.fn((input: TranslateTurnInput) => {
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
        transcribeAndTranslate: vi.fn().mockResolvedValue({
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

    it("speaks every clause in the turn's chosen voice", async () => {
      // A turn split across clauses must not change speaker part-way through,
      // so the gender is asserted on each call rather than only the first.
      const { service, synthesize } = makeService({
        transcribeAndTranslate: vi.fn().mockResolvedValue({
          sourceText: 'xin chào, cái này giá bao nhiêu?',
          targetText: 'Hello, how much does this cost?',
          targetLanguage: 'en',
        }),
      });
      const socket = new FakeSocket();
      service.start(socket, { direction: 'vi_to_en', voiceGender: 'male' });
      const sessionId = socket.ofType('server.session.ready')[0]!.sessionId;
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(synthesize).toHaveBeenCalledTimes(2);
      for (const [req] of synthesize.mock.calls) {
        expect(req).toMatchObject({ voiceGender: 'male' });
      }
    });

    it('pushes the first clause audio before the second is synthesized', async () => {
      // Ordering is the whole point: if the service gathered every clause up
      // front, nothing would reach the client until the last one was done.
      const order: string[] = [];
      const { service } = makeService({
        transcribeAndTranslate: vi.fn().mockResolvedValue({
          sourceText: 'a',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: vi.fn((req: SynthesizeRequest) => {
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
        transcribeAndTranslate: vi.fn().mockResolvedValue({
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
  // suspected` in `packages/realtime-client/src/audio/capture-pump.spec.ts` — if that one goes,
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
      const failing = vi
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
        transcribe: vi.fn().mockResolvedValue('xin chào tôi muốn'),
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
      const transcribe = vi.fn(
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
        transcribe: vi.fn().mockRejectedValue(new Error('sidecar down')),
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
        transcribe: vi.fn().mockResolvedValue('   '),
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
      const transcribe = vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng');
      const { service, translate } = makeService({
        transcribe,
        translate: vi.fn().mockResolvedValue('yesterday I booked a room'),
      });
      const socket = new FakeSocket();

      await openTurnWithTwoReads(service, socket);

      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(translate).toHaveBeenCalledTimes(1);
      expect(socket.ofType('server.translation.partial')[0]).toMatchObject({
        text: 'yesterday I booked a room',
        direction: 'vi_to_en',
      });
    });

    // The pieces are an addition to the finished guess, never a replacement:
    // a client may ignore them and still see the whole translation.
    it('sends the translation in pieces as it is written', async () => {
      const { service } = makeService({
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi
          .fn()
          .mockImplementation(
            (req: {
              onChunk?: (delta: string, restart: boolean) => void;
            }): Promise<string> => {
              req.onChunk?.('yesterday ', true);
              req.onChunk?.('I booked a room', false);
              return Promise.resolve('yesterday I booked a room');
            },
          ),
      });
      const socket = new FakeSocket();

      await openTurnWithTwoReads(service, socket, true);

      const deltas = socket.ofType('server.translation.delta');
      expect(deltas.map((d) => (d as { delta: string }).delta)).toEqual([
        'yesterday ',
        'I booked a room',
      ]);
      // One translation, so one label — a client appends rather than restarts.
      const labels = new Set(
        deltas.map((d) => (d as { generation: number }).generation),
      );
      expect(labels.size).toBe(1);
      expect(socket.ofType('server.translation.partial')[0]).toMatchObject({
        text: 'yesterday I booked a room',
      });
    });

    // A provider may abandon one key and retry on another. What it already
    // showed belongs to the attempt that failed, and only a new label tells the
    // client to drop it instead of appending to it.
    it('relabels the pieces when the provider starts an attempt over', async () => {
      const { service } = makeService({
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi
          .fn()
          .mockImplementation(
            (req: {
              onChunk?: (delta: string, restart: boolean) => void;
            }): Promise<string> => {
              req.onChunk?.('yester', true);
              req.onChunk?.('yesterday I booked', true);
              return Promise.resolve('yesterday I booked a room');
            },
          ),
      });
      const socket = new FakeSocket();

      await openTurnWithTwoReads(service, socket, true);

      const labels = socket
        .ofType('server.translation.delta')
        .map((d) => (d as { generation: number }).generation);
      expect(labels).toHaveLength(2);
      expect(labels[0]).not.toBe(labels[1]);
    });

    // The guard for a tab opened before these events existed. Server events are
    // parsed against a strict union, so an unknown type reaches the user as an
    // error — once per piece of every translation. The extension and mobile do
    // not send the flag, and this is what keeps the plan's promise not to touch
    // them.
    it('sends no pieces to a client that did not ask for them', async () => {
      const { service } = makeService({
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi
          .fn()
          .mockImplementation(
            (req: {
              onChunk?: (delta: string, restart: boolean) => void;
            }): Promise<string> => {
              req.onChunk?.('yesterday ', true);
              return Promise.resolve('yesterday I booked a room');
            },
          ),
      });
      const socket = new FakeSocket();

      await openTurnWithTwoReads(service, socket);

      expect(socket.ofType('server.translation.delta')).toHaveLength(0);
      // And it still gets the finished translation, so it loses only smoothness.
      expect(socket.ofType('server.translation.partial')).toHaveLength(1);
    });

    it('leaves a short turn to its own ending', async () => {
      const { service, translate } = makeService({
        transcribe: vi.fn().mockResolvedValue('xin chào'),
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
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi.fn().mockResolvedValue('yesterday I booked a room'),
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
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi.fn().mockRejectedValue(new Error('rate limited')),
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
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi.fn().mockResolvedValue('yesterday'),
      });
      const socket = new FakeSocket();
      await openTurnWithTwoReads(service, socket);

      const [request] = translate.mock.calls[0] as [{ models?: string[] }];
      expect(request.models).toEqual(['gemini-3.5-flash-lite']);
    });
  });

  describe('turn metrics', () => {
    it('records the timings a latency table is built from', async () => {
      const { service, recorded } = makeService({
        transcribeAndTranslate: vi.fn().mockResolvedValue({
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
        transcribeAndTranslate: vi
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
      const { service, recorded, translate } = makeService({
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi.fn().mockResolvedValue('yesterday I booked a room'),
      });
      const socket = new FakeSocket();
      await openTurnWithTwoReads(service, socket);
      expect(translate).toHaveBeenCalledTimes(1);

      await service.end(socket);

      expect(recorded[0]?.liveTranslations).toBe(1);
    });

    // The verdict is taken before the pipeline is awaited, so a turn that dies
    // in the await still reports it. Marking it afterwards instead reads as
    // "this turn never used a guess" on exactly the turns that did.
    it('reports a reused guess even when that guess is what failed', async () => {
      const { service, recorded } = makeService({
        transcribeAndTranslate: vi
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
        transcribeAndTranslate: vi
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
      const { service, synthesize, recorded } = makeService({
        transcribeAndTranslate: vi.fn().mockResolvedValue({
          sourceText: 'xin chào',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: vi.fn().mockResolvedValue({
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

      // A turn the listener never heard is not a completed turn, in either
      // place that says so. Calling it 'completed' put a turn that delivered no
      // audio into the latency table beside turns that delivered all of it, and
      // told the client the same story right after an error saying otherwise.
      expect(socket.ofType('server.session.ended')[0]?.reason).toBe(
        'unsupported_audio',
      );
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.completed).toBe(false);
    });

    // The same latency table, spoiled from the other side: `end()` refuses to
    // record a turn whose client left before synthesis, but a client leaving
    // *during* it used to be filed as a success — with a lastAudioAtMs cut short
    // by the departure, which reads as an unusually fast turn.
    // This used to assert that nothing was recorded. The quota was spent either
    // way, so silence made requests-per-minute computed from the log read lower
    // than reality — and continuous capture produces more abandoned turns than any
    // other mode. The row is written and marked incomplete, so a latency table
    // that filters on `completed` is unaffected while the cost is still accounted
    // for.
    it('records an abandoned turn as incomplete rather than not at all', async () => {
      const { service, recorded } = makeService({
        transcribeAndTranslate: vi.fn().mockResolvedValue({
          sourceText: 'xin chào',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: vi.fn(() => {
          // Gone while the first of the two clauses is being synthesized.
          service.disconnect(socket);
          return Promise.resolve({ bytes: ttsWav(200), mimeType: 'audio/wav' });
        }),
      });
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        completed: false,
        reason: 'abandoned',
      });
    });
  });

  // This replaces a test that asserted the opposite — that a start during a
  // translation was refused with `session_busy`. That guard existed because a
  // one-entry map meant the second turn overwrote the first, and the in-flight
  // `end()` then finished by deleting a turn the client had just been handed.
  // Keyed by session id, the collision cannot happen, and letting the speaker
  // carry on talking through a translation is the entire point of the change.
  it('opens a turn while another is still being translated', async () => {
    let release: (() => void) | undefined;
    const { service } = makeService({
      transcribeAndTranslate: vi.fn(
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
    const first = open(service, socket, 'turn-1');
    service.pushFrame(socket, frame({ sessionId: first }));

    const turn = service.end(socket, first);
    const second = open(service, socket, 'turn-2'); // the speaker keeps going

    expect(socket.ofType('server.error')).toHaveLength(0);
    expect(second).not.toBe(first);
    const readies = socket.ofType('server.session.ready');
    expect(readies).toHaveLength(2);
    expect(readies.map((e) => e.turnId)).toEqual(['turn-1', 'turn-2']);

    // The second turn takes audio while the first is still translating, and the
    // first still finishes normally.
    service.pushFrame(socket, frame({ sessionId: second }));
    expect(socket.ofType('server.error')).toHaveLength(0);

    release?.();
    await turn;
    const ended = socket.ofType('server.session.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.reason).toBe('completed');
    // Only the turn that ended was closed; the other is still open.
    expect(ended[0]?.sessionId).toBe(first);
  });

  describe('concurrency ceilings', () => {
    // Fairness, not resources: one client must not be able to take the machine.
    it('refuses a fourth turn on one socket, naming the refused turn', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      open(service, socket, 'turn-1');
      open(service, socket, 'turn-2');
      open(service, socket, 'turn-3');

      service.start(
        socket,
        { direction: 'vi_to_en', voiceGender: 'female' },
        'turn-4',
      );

      expect(socket.ofType('server.session.ready')).toHaveLength(3);
      const error = socket.ofType('server.error')[0];
      expect(error).toMatchObject({ code: 'too_many_turns' });
      // The refusal happens before any session id exists, so the client's own
      // name is the only thing that can identify which turn was turned away. A
      // client that cannot tell leaves an ordered playback queue waiting forever.
      expect(error?.turnId).toBe('turn-4');
      expect(error?.sessionId).toBeUndefined();
    });

    // The ceiling that actually guards the machine. The sidecars are one shared
    // process each, so a per-socket limit cannot see two sockets at three turns
    // apiece — six concurrent inferences with neither socket's ceiling touched.
    it('refuses a seventh turn across sockets even though no socket is full', () => {
      const { service } = makeService();
      const one = new FakeSocket();
      const two = new FakeSocket();
      const three = new FakeSocket();
      for (const socket of [one, two]) {
        open(service, socket, 'a');
        open(service, socket, 'b');
        open(service, socket, 'c');
      }

      service.start(
        three,
        { direction: 'vi_to_en', voiceGender: 'female' },
        'turn-7',
      );

      expect(three.ofType('server.session.ready')).toHaveLength(0);
      expect(three.ofType('server.error')[0]).toMatchObject({
        code: 'too_many_turns',
        turnId: 'turn-7',
      });
      // The socket that was refused had no turns at all, so a per-socket ceiling
      // would have allowed this one.
      expect(one.ofType('server.error')).toHaveLength(0);
      expect(two.ofType('server.error')).toHaveLength(0);
    });

    it('frees the ceiling again once a turn closes', async () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const first = open(service, socket, 'turn-1');
      open(service, socket, 'turn-2');
      open(service, socket, 'turn-3');

      service.pushFrame(socket, frame({ sessionId: first }));
      await service.end(socket, first);

      open(service, socket, 'turn-4');
      expect(socket.ofType('server.error')).toHaveLength(0);
    });
  });

  describe('turns do not interfere', () => {
    it('keeps each turn’s audio in its own buffer', async () => {
      const { service, transcribeAndTranslate } = makeService();
      const socket = new FakeSocket();
      const a = open(service, socket, 'turn-a');
      const b = open(service, socket, 'turn-b');

      // Two frames into A, one into B.
      service.pushFrame(socket, frame({ sessionId: a, sequence: 0 }));
      service.pushFrame(socket, frame({ sessionId: a, sequence: 1 }));
      service.pushFrame(socket, frame({ sessionId: b, sequence: 0 }));

      await service.end(socket, b);
      const bWav = transcribeAndTranslate.mock.calls.at(-1)?.[0] as
        TranslateTurnInput | undefined;
      await service.end(socket, a);
      const aWav = transcribeAndTranslate.mock.calls.at(-1)?.[0] as
        TranslateTurnInput | undefined;

      // A carries twice the audio B does. Had the buffers mixed, they would
      // match — which is the failure this asserts against, since a mixed buffer
      // corrupts the utterance without reporting anything.
      expect(aWav?.audio.byteLength).toBeGreaterThan(
        bWav?.audio.byteLength ?? 0,
      );
    });

    it('lets one turn fail without disturbing another', async () => {
      const { service } = makeService({
        transcribeAndTranslate: vi
          .fn()
          .mockRejectedValueOnce(new BadRequestException('No speech detected'))
          .mockResolvedValue({
            sourceText: 'xin chào',
            targetText: 'hello',
            targetLanguage: 'en',
          }),
      });
      const socket = new FakeSocket();
      const a = open(service, socket, 'turn-a');
      const b = open(service, socket, 'turn-b');
      service.pushFrame(socket, frame({ sessionId: a }));
      service.pushFrame(socket, frame({ sessionId: b }));

      await service.end(socket, a);
      await service.end(socket, b);

      const ended = socket.ofType('server.session.ended');
      expect(ended.find((e) => e.sessionId === a)?.reason).toBe('error');
      expect(ended.find((e) => e.sessionId === b)?.reason).toBe('completed');
    });

    it('closes every turn when the socket drops', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const a = open(service, socket, 'turn-a');
      open(service, socket, 'turn-b');
      open(service, socket, 'turn-c');

      service.disconnect(socket);

      // Nothing is reachable afterwards: a frame for a turn the socket used to
      // hold finds no turn at all.
      service.pushFrame(socket, frame({ sessionId: a }));
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'no_active_session',
      });
    });
  });

  describe('client-reported metrics', () => {
    // Two headline numbers — capture coverage and how far the translation drifts
    // behind the speaker — exist only on the client: this server cannot know when
    // someone began speaking or when a loudspeaker produced sound.
    it('files a row for a turn the socket still holds', () => {
      const { service, recordedClient } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.recordClientMetrics(socket, clientMetrics(sessionId));

      expect(recordedClient).toHaveLength(1);
      expect(recordedClient[0]).toMatchObject({ sessionId, outcome: 'played' });
    });

    // Measurements for a turn necessarily arrive after it ends: they say when its
    // audio finished playing. Refusing them would drop every row worth having.
    it('files a row for a turn that just closed', async () => {
      const { service, recordedClient } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));
      await service.end(socket, sessionId);

      service.recordClientMetrics(socket, clientMetrics(sessionId));

      expect(recordedClient).toHaveLength(1);
    });

    // The whole security of this path. A turn id is not a capability, and
    // /ws/translate takes no authentication, so without the ownership check any
    // client could file rows against another client's turn by naming it.
    it('refuses a row for a turn belonging to a different socket', () => {
      const { service, recordedClient } = makeService();
      const mine = new FakeSocket();
      const theirs = new FakeSocket();
      const sessionId = open(service, mine);
      open(service, theirs);

      service.recordClientMetrics(theirs, clientMetrics(sessionId));

      expect(recordedClient).toHaveLength(0);
    });

    it('refuses a row for a turn that never existed', () => {
      const { service, recordedClient } = makeService();
      const socket = new FakeSocket();
      open(service, socket);

      service.recordClientMetrics(socket, clientMetrics('invented'));

      expect(recordedClient).toHaveLength(0);
    });

    // Silently. Telling a caller which ids exist would make this an oracle for
    // guessing them.
    it('says nothing to the client about a refused row', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      open(service, socket);
      const before = socket.events.length;

      service.recordClientMetrics(socket, clientMetrics('invented'));

      expect(socket.events).toHaveLength(before);
    });

    // A client sends one row per turn, so a second is either a bug or an attempt to
    // make this endpoint write to disk in a loop. Each accepted row costs a log line
    // and a queued append, which is enough for one connection to drive log and disk
    // growth at line rate on an endpoint that takes no authentication.
    it('accepts one row per turn and ignores repeats', () => {
      const { service, recordedClient } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      for (let i = 0; i < 50; i += 1) {
        service.recordClientMetrics(socket, clientMetrics(sessionId));
      }

      expect(recordedClient).toHaveLength(1);
    });

    it('still accepts a row for a different turn on the same socket', () => {
      const { service, recordedClient } = makeService();
      const socket = new FakeSocket();
      const a = open(service, socket, 'turn-a');
      const b = open(service, socket, 'turn-b');

      service.recordClientMetrics(socket, clientMetrics(a));
      service.recordClientMetrics(socket, clientMetrics(b));

      expect(recordedClient.map((row) => row.sessionId)).toEqual([a, b]);
    });

    it('forgets a socket’s turns once it disconnects', () => {
      const { service, recordedClient } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      service.disconnect(socket);
      service.recordClientMetrics(socket, clientMetrics(sessionId));

      expect(recordedClient).toHaveLength(0);
    });
  });

  /**
   * Every way a turn can end now writes a row.
   *
   * `LivePreview` fires transcription and translation requests while the turn is
   * still open, so a turn that ends badly has already spent quota. The paths below
   * used to write nothing at all, which made requests-per-minute computed from the
   * log read LOWER than reality — and continuous capture is the mode that produces
   * the most of them.
   */
  describe('metrics on every termination path', () => {
    it('records a turn that carried no audio', async () => {
      const { service, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      await service.end(socket, sessionId);

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'no_audio',
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        completed: false,
        reason: 'no_audio',
        inputBytes: 0,
      });
    });

    it('records a turn cut off by the length cap', () => {
      const { service, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      // A payload past the whole-turn byte ceiling.
      const huge = Buffer.alloc(MAX_SAMPLE_RATE * 2 * 61).toString('base64');
      service.pushFrame(socket, frame({ sessionId, payload: huge }));

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'turn_too_long',
      });
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        completed: false,
        reason: 'turn_too_long',
      });
    });

    it('records a completed turn with no reason attached', async () => {
      const { service, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket, sessionId);

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ completed: true });
      expect(recorded[0]?.reason).toBeUndefined();
    });
  });

  /**
   * The global ceiling is what makes this necessary.
   *
   * A turn used to live until `client.session.end` or a disconnect. With a per-socket
   * ceiling that only ever hurt the socket holding it; with a process-wide one, two
   * unauthenticated sockets sending six starts and nothing else deny the service to
   * everybody. `/ws/translate` takes no authentication, so introducing the global
   * ceiling obliged this.
   */
  describe('idle turn sweep', () => {
    const LATER = 60_000;

    it('closes a turn whose client sent a start and then nothing', () => {
      const { service, recorded } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      const closed = service.sweepIdleTurns(Date.now() + LATER);

      expect(closed).toBe(1);
      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'turn_abandoned',
      });
      expect(socket.ofType('server.session.ended')[0]).toMatchObject({
        sessionId,
        reason: 'idle_timeout',
      });
      // Recorded like every other termination path — the live preview may already
      // have spent requests on it.
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        completed: false,
        reason: 'idle_timeout',
      });
    });

    it('frees the ceiling it was holding', () => {
      const { service } = makeService();
      const one = new FakeSocket();
      const two = new FakeSocket();
      for (const socket of [one, two]) {
        open(service, socket, 'a');
        open(service, socket, 'b');
        open(service, socket, 'c');
      }
      const three = new FakeSocket();
      // Global ceiling reached, so a third client gets nothing.
      service.start(
        three,
        { direction: 'vi_to_en', voiceGender: 'female' },
        't',
      );
      expect(three.ofType('server.error')[0]).toMatchObject({
        code: 'too_many_turns',
      });

      expect(service.sweepIdleTurns(Date.now() + LATER)).toBe(6);

      service.start(
        three,
        { direction: 'vi_to_en', voiceGender: 'female' },
        't2',
      );
      expect(three.ofType('server.session.ready')).toHaveLength(1);
    });

    it('leaves a turn alone while frames are still arriving', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);

      // A frame at the later instant means the client is plainly still there.
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + LATER);
      service.pushFrame(socket, frame({ sessionId }));
      const closed = service.sweepIdleTurns(Date.now());
      vi.spyOn(Date, 'now').mockRestore();

      expect(closed).toBe(0);
      expect(socket.ofType('server.session.ended')).toHaveLength(0);
    });

    // A translating turn is doing work with a measured tail of up to ~9s and closes
    // itself. Sweeping it would discard an answer the listener is waiting for.
    it('never closes a turn that is translating', async () => {
      let release: (() => void) | undefined;
      const { service } = makeService({
        transcribeAndTranslate: vi.fn(
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

      const turn = service.end(socket, sessionId);
      expect(service.sweepIdleTurns(Date.now() + LATER)).toBe(0);

      release?.();
      await turn;
      expect(socket.ofType('server.session.ended')[0]?.reason).toBe(
        'completed',
      );
    });

    it('does nothing when every turn is fresh', () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      open(service, socket);

      expect(service.sweepIdleTurns(Date.now())).toBe(0);
    });
  });

  describe('guards that stay', () => {
    // Removing this would let two pipelines run on one turn: twice the quota,
    // two metrics rows, and the listener hearing the sentence twice.
    it('still refuses to end the same turn twice', async () => {
      const { service } = makeService();
      const socket = new FakeSocket();
      const sessionId = open(service, socket);
      service.pushFrame(socket, frame({ sessionId }));

      await service.end(socket, sessionId);
      await service.end(socket, sessionId);

      // The turn left the registry on the first end, so the second finds nothing
      // to end rather than starting a second pipeline over it.
      expect(socket.ofType('server.session.ended')).toHaveLength(1);
      expect(
        socket
          .ofType('server.error')
          .some(
            (e) => e.code === 'session_busy' || e.code === 'no_active_session',
          ),
      ).toBe(true);
    });

    // Removing this would let a frame append to a buffer that end() is already
    // reading across an await, making usableSpeculation() and every metrics row
    // for the turn nondeterministic.
    it('still refuses a frame that arrives after the turn began translating', async () => {
      let release: (() => void) | undefined;
      const { service } = makeService({
        transcribeAndTranslate: vi.fn(
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

      const turn = service.end(socket, sessionId);
      service.pushFrame(socket, frame({ sessionId, sequence: 1 }));

      expect(socket.ofType('server.error')[0]).toMatchObject({
        code: 'session_busy',
      });

      release?.();
      await turn;
    });
  });

  // Finishing a turn for a client that left costs real translation quota and
  // writes to a closed socket.
  it('abandons a turn whose socket disconnected while translating', async () => {
    let release: (() => void) | undefined;
    const { service, synthesize, recorded } = makeService({
      transcribeAndTranslate: vi.fn(
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
    // Nothing was synthesized and nothing was said, but the translation request
    // was made and has to appear in the log that requests-per-minute is computed
    // from.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      completed: false,
      reason: 'abandoned',
    });
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
        transcribeAndTranslate: vi.fn(
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
      const transcribe = vi.fn(
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
        transcribe: vi.fn().mockResolvedValue('hôm qua tôi có đặt phòng'),
        translate: vi.fn(
          () => new Promise<string>((resolve) => (release = resolve)),
        ),
      });
      const socket = new FakeSocket();

      await openTurnWithTwoReads(service, socket);
      expect(translate).toHaveBeenCalledTimes(1); // it really is in flight

      service.disconnect(socket);
      release('yesterday I booked a room');
      await settle();

      expect(socket.ofType('server.translation.partial')).toHaveLength(0);
    });

    it('stops synthesizing clauses once the client has gone', async () => {
      const spoken: string[] = [];
      const { service } = makeService({
        transcribeAndTranslate: vi.fn().mockResolvedValue({
          sourceText: 'a',
          targetText: 'Hello, how are you?',
          targetLanguage: 'en',
        }),
        synthesize: vi.fn((req: SynthesizeRequest) => {
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

      service.start(socket, { direction: 'vi_to_en', voiceGender: 'female' });

      const ready = socket.ofType('server.session.ready');
      expect(ready).toHaveLength(2);
      expect(ready[1]?.sessionId).not.toBe(first);
      expect(socket.ofType('server.error')).toHaveLength(0);
    });
  });
});

/**
 * The speaker vector, which is an enhancement bolted to a translator and must
 * never behave like part of it.
 *
 * Timing is asserted structurally rather than by the clock. A wall-clock
 * assertion in CI flakes, a flaky guard gets deleted, and the defect it guarded
 * — an embedding awaited in the wrong place, so it runs after the transcript
 * instead of beside it — ships looking exactly like working code, only slower.
 */
describe('speaker embedding', () => {
  const openAsking = (
    service: TranslationSessionService,
    socket: FakeSocket,
  ): string => {
    service.start(socket, {
      direction: 'vi_to_en',
      voiceGender: 'female',
      embedSpeaker: true,
    });
    return socket.ofType('server.session.ready').at(-1)!.sessionId;
  };

  const speak = async (
    service: TranslationSessionService,
    socket: FakeSocket,
    sessionId: string,
  ) => {
    service.pushFrame(socket, frame({ sessionId, sequence: 0 }));
    await service.end(socket);
  };

  it('is not requested at all while the flag is off', async () => {
    const { service, embedSpeaker } = makeService();
    const socket = new FakeSocket();

    await speak(service, socket, openAsking(service, socket));

    expect(embedSpeaker).not.toHaveBeenCalled();
    expect(socket.ofType('server.turn.embedding')).toHaveLength(0);
  });

  it('is not requested for a client that did not ask', async () => {
    // The half that protects a tab loaded before this event existed: it never
    // asks, so it is never sent something its contract cannot parse.
    const { service, embedSpeaker } = makeService({}, true);
    const socket = new FakeSocket();
    const sessionId = open(service, socket);

    await speak(service, socket, sessionId);

    expect(embedSpeaker).not.toHaveBeenCalled();
    expect(socket.ofType('server.turn.embedding')).toHaveLength(0);
  });

  it('starts beside the translation rather than after it', async () => {
    // The defect this exists to catch is invisible: everything still works, the
    // turn is just slower by the whole cost of an embedding. So the assertion is
    // that the call was made while the translation was still pending.
    let embedCalledDuringTranslation = false;
    let releaseTranslation!: (value: unknown) => void;
    const translationPending = new Promise((resolve) => {
      releaseTranslation = resolve;
    });

    const transcribeAndTranslate = vi.fn(async () => {
      await translationPending;
      return {
        sourceText: 'xin chào',
        targetText: 'hello',
        targetLanguage: 'en',
      };
    });
    const embedSpeaker = vi.fn(async () => {
      embedCalledDuringTranslation = true;
      return [0.6, 0.8];
    });

    const { service } = makeService(
      { transcribeAndTranslate, embedSpeaker },
      true,
    );
    const socket = new FakeSocket();
    const sessionId = openAsking(service, socket);
    service.pushFrame(socket, frame({ sessionId, sequence: 0 }));

    const finished = service.end(socket);
    await Promise.resolve();
    expect(embedCalledDuringTranslation).toBe(true);

    releaseTranslation(undefined);
    await finished;
  });

  it('sends the vector after the transcript, never before it', async () => {
    const { service } = makeService({}, true);
    const socket = new FakeSocket();

    await speak(service, socket, openAsking(service, socket));

    const types = socket.events.map((event) => event.type);
    expect(types.indexOf('server.turn.embedding')).toBeGreaterThan(
      types.indexOf('server.transcript.final'),
    );
    const [event] = socket.ofType('server.turn.embedding');
    expect(event).toMatchObject({ vector: [0.6, 0.8], dim: 2 });
    expect(event?.audioMs).toBeGreaterThan(0);
  });

  it('lets the turn finish when the sidecar fails', async () => {
    // Attribution is an enhancement on a translator. A sidecar that is down
    // costs a label, not a translation.
    const embedSpeaker = vi.fn().mockResolvedValue(null);
    const { service } = makeService({ embedSpeaker }, true);
    const socket = new FakeSocket();

    await speak(service, socket, openAsking(service, socket));

    expect(socket.ofType('server.turn.embedding')).toHaveLength(0);
    expect(socket.ofType('server.transcript.final')).toHaveLength(1);
    expect(socket.ofType('server.session.ended')).toHaveLength(1);
  });
});

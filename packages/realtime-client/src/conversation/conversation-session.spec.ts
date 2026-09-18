import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerEvent, SessionOptions, TranscriptSegment } from '@chatofy/types';
import { ConversationSession, type ConversationRuntimeOptions } from './conversation-session.js';
import type { ConversationStatus } from './conversation-status.js';
import {
  FakeAudioContext,
  FakeMediaStream,
  FakeTranslateSocket,
  FakeWorkletNode,
} from './fake-audio-context.js';
import { pcm16ToBase64 } from '../audio/pcm-resampler.js';
import type { PlaybackSink } from '../audio/ordered-playback.js';
import type { TranslateSocket, TranslateSocketHandlers } from '../transport/translate-socket.js';

/**
 * The worklet posts 1024 samples at the context's rate. At 48 kHz that
 * downsamples 3:1 to ~341 samples, i.e. ~21ms of speech per block — so the
 * gate's 120ms confirmation needs six of them and its 500ms hangover needs
 * twenty-four. The counts below are comfortably past both.
 */
/** Settings every test starts with; the voice is beside the point for most. */
const startOptions: SessionOptions = { direction: 'vi_to_en', voiceGender: 'female' };

const BLOCKS_TO_CONFIRM_SPEECH = 8;
const BLOCKS_TO_CLOSE_TURN = 30;

/**
 * Every frame carries a unique marker in sample 0.
 *
 * Without it, blocks are byte-identical and a test can count how many were sent
 * but never notice one arriving twice — which is the exact defect the pending
 * flush has to avoid. The value is four orders under the speech amplitude, so
 * marking cannot turn silence into speech.
 */
let nextTag = 0;
const speechFrame = (): Float32Array => {
  const block = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 3) * 0.25);
  block[0] = ++nextTag * 1e-4;
  return block;
};
const silenceFrame = (): Float32Array => {
  const block = new Float32Array(1024);
  block[0] = ++nextTag * 1e-4;
  return block;
};

const audioFrameEvent = (sessionId = 's1'): ServerEvent => ({
  type: 'server.audio.frame',
  frame: {
    sessionId,
    encoding: 'pcm16',
    sampleRate: 24000,
    sequence: 0,
    timestamp: 0,
    payload: pcm16ToBase64(new Int16Array(160)),
  },
});

const readyEvent = (sessionId: string): ServerEvent => ({
  type: 'server.session.ready',
  sessionId,
});

const endedEvent = (sessionId = 's1'): ServerEvent => ({
  type: 'server.session.ended',
  reason: 'completed',
  sessionId,
});

/**
 * A playback sink that records instead of sounding.
 *
 * Stands in for one that ships samples to another context — the extension's
 * outbound direction hands them to the meeting page. `drain` is exposed because
 * with a remote sink the moment a turn stops sounding is reported back rather
 * than observed on a local clock, and that report has to reach the ordering
 * layer or the next turn never plays.
 */
class RecordingSink implements PlaybackSink {
  readonly enqueued: { turnKey: string; samples: number; sampleRate: number }[] = [];
  readonly stopped: string[] = [];
  private readonly sounding = new Set<string>();

  constructor(private readonly onTurnDrained: (turnKey: string) => void) {}

  enqueue(turnKey: string, samples: Int16Array, sampleRate: number): void {
    this.enqueued.push({ turnKey, samples: samples.length, sampleRate });
    this.sounding.add(turnKey);
  }

  isPlayingTurn(turnKey: string): boolean {
    return this.sounding.has(turnKey);
  }

  get isPlaying(): boolean {
    return this.sounding.size > 0;
  }

  stop(): void {
    this.sounding.clear();
  }

  stopTurn(turnKey: string): void {
    this.stopped.push(turnKey);
    this.sounding.delete(turnKey);
  }

  /** Report a turn finished, the way a remote sink would. */
  drain(turnKey: string): void {
    this.sounding.delete(turnKey);
    this.onTurnDrained(turnKey);
  }

  /** The one turn key this sink has seen, for a test that never learns it. */
  get onlyTurnKey(): string {
    return this.enqueued[0]!.turnKey;
  }
}

interface HarnessOptions {
  openMicrophone?: () => Promise<FakeMediaStream>;
  createSocket?: (handlers: TranslateSocketHandlers) => FakeTranslateSocket;
  addModule?: (url: string) => Promise<void>;
  /** Collects the sink the session was given, when one is injected. */
  sink?: (sink: RecordingSink) => void;
  /** Static settings for the run. */
  runtime?: ConversationRuntimeOptions;
  /** The getter itself, for tests about when it is read. Wins over `runtime`. */
  runtimeOptions?: () => ConversationRuntimeOptions;
}

function harness(options: HarnessOptions = {}) {
  const context = new FakeAudioContext();
  const stream = new FakeMediaStream();
  const node = new FakeWorkletNode();
  const sockets: FakeTranslateSocket[] = [];
  const statuses: ConversationStatus[] = [];
  const errors: (string | null)[] = [];

  if (options.addModule) {
    context.audioWorklet.addModule = options.addModule;
  }

  const listeners = {
    onStatus: (status: ConversationStatus) => statuses.push(status),
    onLevel: vi.fn(),
    onMuted: vi.fn(),
    onError: vi.fn((message: string | null) => errors.push(message)),
    onEchoHeard: vi.fn(),
    onServerEvent: vi.fn(),
    onReset: vi.fn(),
    onStopped: vi.fn(),
    onTurnCaptured: vi.fn(),
    onTurnAbandoned: vi.fn(),
    onLog: vi.fn(),
  };

  const openMicrophone = options.openMicrophone ?? (() => Promise.resolve(stream));

  const session = new ConversationSession(
    {
      openMicrophone: openMicrophone as unknown as () => Promise<MediaStream>,
      createAudioContext: () => context as unknown as AudioContext,
      createWorkletNode: () => node as unknown as AudioWorkletNode,
      createSocket: (handlers: TranslateSocketHandlers) => {
        const socket = options.createSocket?.(handlers) ?? new FakeTranslateSocket(handlers);
        sockets.push(socket);
        return socket as unknown as TranslateSocket;
      },
      createPlaybackSink: options.sink
        ? (_context, onTurnDrained) => {
            const sink = new RecordingSink(onTurnDrained);
            options.sink!(sink);
            return sink;
          }
        : undefined,
      workletUrl: '/worklets/mic-capture-processor.js',
    },
    listeners,
    options.runtimeOptions ?? (() => options.runtime ?? {}),
  );

  const talk = (blocks = BLOCKS_TO_CONFIRM_SPEECH) => {
    for (let i = 0; i < blocks; i += 1) node.deliver(speechFrame());
  };
  const hush = (blocks = BLOCKS_TO_CLOSE_TURN) => {
    for (let i = 0; i < blocks; i += 1) node.deliver(silenceFrame());
  };

  return {
    session,
    context,
    stream,
    node,
    listeners,
    statuses,
    errors,
    talk,
    hush,
    socket: () => sockets[sockets.length - 1]!,
    sockets,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

/** Let the playback queue's 60ms drain check fire. */
async function drainPlayback(context: FakeAudioContext): Promise<void> {
  vi.useFakeTimers();
  context.flushEnded();
  await vi.advanceTimersByTimeAsync(60);
  vi.useRealTimers();
}

/**
 * Let a fixed number of already-settled promises resolve.
 *
 * Used to run `session.start()` up to the point where it is blocked on a
 * socket connect the test is holding open, without pinning the exact number
 * of internal `await`s: bounded rather than a `while` loop on a condition,
 * so a test that gets the count wrong fails on its own assertions instead of
 * hanging the run.
 */
async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

/**
 * Drive one real turn to the point where its audio is playing.
 *
 * Every event on this path is now routed to a specific turn, so a test that emits
 * `server.audio.frame` without a turn open is asserting against a turn the session
 * correctly refuses to invent. Opening the turn the way capture does is what makes
 * these assertions mean anything.
 */
function openTurnAndPlay(h: ReturnType<typeof harness>, sessionId = 's1'): void {
  h.talk();
  h.hush(); // closes the turn client-side, as the gate would
  h.socket().emit(readyEvent(sessionId));
  h.socket().emit(audioFrameEvent(sessionId));
}

describe('ConversationSession', () => {
  describe('re-arming the microphone', () => {
    // Releasing on either condition alone reopens the microphone into our own
    // loudspeaker, and two people sharing one phone get a loop where the app
    // translates itself forever.
    it('stays shut when the turn ended but audio is still playing', async () => {
      const h = harness();
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      h.statuses.length = 0;

      h.socket().emit(endedEvent());

      expect(h.statuses).not.toContain('listening');
    });

    it('stays shut when audio drained but the server has not ended the turn', async () => {
      const h = harness();
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      h.statuses.length = 0;

      await drainPlayback(h.context);

      expect(h.statuses).not.toContain('listening');
    });

    it('re-arms when the turn ends first and audio drains after', async () => {
      const h = harness();
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      h.socket().emit(endedEvent());
      h.statuses.length = 0;
      h.listeners.onMuted.mockClear();

      await drainPlayback(h.context);

      expect(h.statuses).toEqual(['listening']);
      expect(h.listeners.onMuted).toHaveBeenCalledWith(false);
    });

    it('re-arms when audio drains first and the turn ends after', async () => {
      const h = harness();
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      await drainPlayback(h.context);
      h.statuses.length = 0;
      h.listeners.onMuted.mockClear();

      h.socket().emit(endedEvent());

      expect(h.statuses).toEqual(['listening']);
      expect(h.listeners.onMuted).toHaveBeenCalledWith(false);
    });
  });

  describe('a turn the server kept refusing', () => {
    /**
     * The refusal comes from the server, but giving up on it does not: the
     * pipeline retries for as long as the audio is worth keeping and then
     * closes the turn itself, for a turn that never got a session id. Read as a
     * server-confirmed close, that left
     * no live line, no abandoned marker and no saved row — while the recorder,
     * which taps the microphone independently, kept the audio. A conversation
     * lost its last sentence that way, and the transcript never said so.
     */
    it('is reported as abandoned rather than vanishing', async () => {
      vi.useFakeTimers();
      const h = harness();
      await h.session.start(startOptions);

      h.talk();
      const start = h.socket().sent.find((e) => e.type === 'client.session.start');
      const turnId = start?.turnId;
      expect(turnId).toBeDefined();

      // Refused steadily for longer than the pipeline will hold the audio, so
      // the retry budget genuinely runs out rather than the loop simply ending.
      // The budget is a deadline now rather than a count of attempts, which is
      // why this is written as elapsed time.
      const CADENCE_MS = 800;
      for (let elapsed = 0; elapsed <= 21_000; elapsed += CADENCE_MS) {
        h.socket().emit({
          type: 'server.error',
          code: 'too_many_turns',
          message: 'too many turns in flight',
          turnId,
        });
        await vi.advanceTimersByTimeAsync(800);
      }
      vi.useRealTimers();

      // Null, not a session id: this turn never reached a server session, which
      // is exactly why the close had to be reported from here.
      expect(h.listeners.onTurnAbandoned).toHaveBeenCalledWith(null, 'too_many_turns');
    });

    /**
     * The marker alone cannot carry this turn, because it is keyed by a session
     * id the turn never received — so the log is the only durable trace it
     * leaves. Two production recordings each lost an utterance whose path could
     * not be established afterwards precisely because nothing wrote this down.
     */
    it('says in the log which path gave the turn up', async () => {
      vi.useFakeTimers();
      const h = harness();
      await h.session.start(startOptions);

      h.talk();
      const turnId = h.socket().sent.find((e) => e.type === 'client.session.start')?.turnId;

      const CADENCE_MS = 800;
      for (let elapsed = 0; elapsed <= 21_000; elapsed += CADENCE_MS) {
        h.socket().emit({
          type: 'server.error',
          code: 'too_many_turns',
          message: 'too many turns in flight',
          turnId,
        });
        await vi.advanceTimersByTimeAsync(CADENCE_MS);
      }
      vi.useRealTimers();

      const lines = h.listeners.onLog.mock.calls.map(([line]) => line as string);
      const abandoned = lines.filter((line) => line.includes('abandoned'));

      // TWO lines for one turn, and that is the behaviour rather than a fault in
      // the test. Two layers give this turn up on their own deadlines: the
      // ordering layer stops waiting for audio that never came, and five seconds
      // later the pipeline stops retrying the refusal. Both call `abandonTurn`,
      // so both were always reported — the log is simply the first thing that
      // makes the pair visible, which is what it is for.
      expect(abandoned).toHaveLength(2);

      // The reason AND the outcome it maps to, so a reader of the log does not
      // have to know `outcomeFor` to tell one path from the other. These two are
      // the whole point: the same turn, two different givers-up.
      expect(abandoned[0]).toContain('stalled -> dropped');
      expect(abandoned[1]).toContain('too_many_turns -> rejected');

      // Named as absent rather than omitted: "no session id" is the diagnostic
      // fact about a turn refused before the server ever named one, not a
      // missing field.
      for (const line of abandoned) expect(line).toContain('sessionId=none');
    });
  });

  describe('audio captured before the handshake lands', () => {
    it('holds it, then sends it in order once the session id arrives', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.talk();
      // The turn is open and the server has not answered yet.
      expect(h.socket().sent.map((e) => e.type)).toContain('client.session.start');
      expect(h.socket().audioFrames).toHaveLength(0);

      h.socket().emit(readyEvent('s1'));

      const frames = h.socket().audioFrames;
      expect(frames.length).toBeGreaterThan(0);
      expect(frames.map((f) => f.sequence)).toEqual(frames.map((_, index) => index));
      for (const frame of frames) expect(frame.sessionId).toBe('s1');
    });

    // The net for the detach in flushPending. A second answer to the handshake
    // finds the queue still holding what the first one sent — unless the flush
    // emptied it before iterating — and resends it with an advancing sequence,
    // which is exactly what the server's replay guard lets through. The
    // utterance doubles and nothing anywhere reports it.
    //
    // The two-turn test below does NOT cover this: onTurnOpen replaces `pending`
    // outright, so stale entries never survive into the next turn. Verified by
    // removing the detach and watching only this test go red.
    it('does not resend held audio when the handshake is answered twice', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.talk();
      h.socket().emit(readyEvent('s1'));
      const afterFirst = h.socket().audioFrames.length;
      expect(afterFirst).toBeGreaterThan(0);

      h.socket().emit(readyEvent('s1'));

      expect(h.socket().audioFrames).toHaveLength(afterFirst);
    });

    it('keeps audio unique and sequences contiguous across two turns', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.talk();
      h.socket().emit(readyEvent('s1'));
      h.talk(4);
      h.hush();
      h.socket().emit(endedEvent());
      await drainPlayback(h.context);

      h.talk();
      h.socket().emit(readyEvent('s2'));
      h.talk(4);

      const payloads = h.socket().audioFrames.map((f) => f.payload);
      expect(payloads.length).toBeGreaterThan(0);
      expect(new Set(payloads).size).toBe(payloads.length);
    });
  });

  /**
   * A pause is the one state that has to look like a teardown to the speaker and
   * like nothing at all to everything else. Every test here is about that gap.
   *
   * Continuous settings throughout, because that is what the web panel runs and
   * because the single-turn path parks the pump between turns for its own
   * reasons — which would hide whether the pause is what stopped capture.
   */
  describe('pausing', () => {
    const continuous = { runtime: { maxInFlight: 3 } };

    it('gives back nothing it is holding', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);

      h.session.pause();

      expect(h.socket().closed).toBe(0);
      expect(h.context.closed).toBe(0);
      expect(h.stream.tracks[0]!.stopped).toBe(0);
      expect(h.listeners.onStopped).not.toHaveBeenCalled();
      expect(h.session.isRunning).toBe(true);
      expect(h.session.isPaused).toBe(true);
    });

    it('closes the turn it interrupts instead of abandoning it', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      h.talk();
      h.socket().emit(readyEvent('s1'));

      h.session.pause();

      // The sentence the speaker had already finished still gets translated: the
      // turn is ended the ordinary way rather than left for the server to sweep.
      expect(h.socket().sent).toContainEqual({ type: 'client.session.end', sessionId: 's1' });
    });

    it('does not record the interrupted turn as a forced cut', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      h.talk();
      h.socket().emit(readyEvent('s1'));

      h.session.pause();
      h.socket().emit(endedEvent('s1'));

      // `cutForced` is this tab's length ceiling cutting someone off mid-word,
      // and it is read as the right-censoring signal of the turn-length
      // distribution. A pause is not a cut, and filing it as one biases that.
      expect(h.listeners.onTurnCaptured).toHaveBeenCalledWith(
        expect.objectContaining({ cutForced: false }),
      );
    });

    it('stops capture, and resuming starts it again on the same socket', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      const socket = h.socket();
      const startsBefore = socket.sent.filter((e) => e.type === 'client.session.start').length;

      h.session.pause();
      h.talk();
      h.hush();

      expect(socket.sent.filter((e) => e.type === 'client.session.start')).toHaveLength(
        startsBefore,
      );

      h.session.resume();
      h.talk();

      expect(socket.sent.filter((e) => e.type === 'client.session.start').length).toBeGreaterThan(
        startsBefore,
      );
      // The same socket throughout — resuming is not a reconnect.
      expect(h.sockets).toHaveLength(1);
      expect(socket.closed).toBe(0);
    });

    it('zeroes the meter, which reports an edge rather than a level', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      h.talk();
      h.listeners.onLevel.mockClear();

      h.session.pause();

      expect(h.listeners.onLevel).toHaveBeenCalledWith(0);
    });

    // The defect this latch exists for. A pause does not interrupt the
    // translation already draining, so frames keep arriving — and each one used
    // to report `playing`, putting the label back a few milliseconds after the
    // user pressed Pause.
    it('holds the paused status against the translation still draining', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.pause();
      h.statuses.length = 0;
      h.socket().emit(audioFrameEvent('s1'));

      expect(h.statuses).not.toContain('playing');
      expect(h.session.isPaused).toBe(true);
    });

    it('lets teardown outrank the pause', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      h.session.pause();
      h.statuses.length = 0;

      h.session.stop();

      expect(h.statuses).toEqual(['idle']);
      expect(h.listeners.onStopped).toHaveBeenCalledTimes(1);
      expect(h.session.isPaused).toBe(false);
    });

    it('ignores a second pause and a resume that was never paused', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);

      h.session.resume(); // never paused
      h.session.pause();
      h.statuses.length = 0;
      h.session.pause(); // already paused

      expect(h.statuses).toEqual([]);
    });
  });

  /**
   * Ending a conversation used to cut three things in one press: capture, the
   * turn the server was still translating, and whatever was mid-word in the
   * loudspeaker. Every test here is about the last two surviving the first.
   */
  describe('ending gracefully', () => {
    const continuous = { runtime: { maxInFlight: 3 } };

    it('turns the microphone off at once, and nothing else', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      const socket = h.socket();
      const sentBefore = socket.sent.length;

      h.session.finish();

      expect(h.stream.tracks[0]!.stopped).toBe(1);
      // The answer is still coming over it, so it stays open.
      expect(socket.closed).toBe(0);
      expect(h.context.closed).toBe(0);
      expect(h.listeners.onStopped).not.toHaveBeenCalled();

      // And no further speech reaches the wire.
      h.talk();
      expect(socket.sent).toHaveLength(sentBefore);
    });

    it('closes the turn being spoken instead of abandoning it', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      h.talk();
      h.socket().emit(readyEvent('s1'));

      h.session.finish();

      expect(h.socket().sent).toContainEqual({ type: 'client.session.end', sessionId: 's1' });
    });

    it('ends by itself once the tail has been spoken', async () => {
      let sink!: RecordingSink;
      const h = harness({ ...continuous, sink: (s) => (sink = s) });
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.finish();
      expect(h.listeners.onStopped).not.toHaveBeenCalled();

      h.socket().emit(endedEvent('s1')); // the server finished translating
      sink.drain(sink.onlyTurnKey); // and the loudspeaker finished with it

      expect(h.statuses.at(-1)).toBe('idle');
      expect(h.listeners.onStopped).toHaveBeenCalledTimes(1);
      expect(h.socket().closed).toBe(1);
    });

    it('tears down immediately when there is no tail to wait for', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);

      h.session.finish();

      expect(h.statuses.at(-1)).toBe('idle');
      expect(h.listeners.onStopped).toHaveBeenCalledTimes(1);
    });

    it('holds the finishing status against the tail still playing', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.finish();
      expect(h.statuses.at(-1)).toBe('finishing');
      h.statuses.length = 0;
      h.socket().emit(audioFrameEvent('s1'));

      expect(h.statuses).not.toContain('playing');
    });

    // Someone pressing End twice is saying the tail is too long. The honest
    // answer is to cut it, not to explain why it is still talking.
    it('cuts the tail when asked a second time', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.finish();
      h.session.finish();

      expect(h.socket().closed).toBe(1);
      expect(h.context.closed).toBe(1);
      expect(h.listeners.onStopped).toHaveBeenCalledTimes(1);
    });

    it('gives up on a drain that never completes', async () => {
      vi.useFakeTimers();
      const h = harness(continuous);
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.finish();
      expect(h.listeners.onStopped).not.toHaveBeenCalled();

      // A reply that never comes: without the deadline the panel would sit on
      // `finishing` with no way out but a reload.
      await vi.advanceTimersByTimeAsync(20_000);

      expect(h.listeners.onStopped).toHaveBeenCalledTimes(1);
      expect(h.statuses.at(-1)).toBe('idle');
    });

    /**
     * The window nothing else covers: `connecting` is reported before the
     * microphone prompt is answered, so this is the FIRST thing a first-time
     * visitor can press. It used to do nothing at all, and then the conversation
     * started anyway when they allowed the prompt they had just decided against.
     */
    it('cancels a start that has not finished connecting', async () => {
      const stream = new FakeMediaStream();
      let releaseMic!: (stream: FakeMediaStream) => void;
      let reachedMic!: () => void;
      const atMic = new Promise<void>((resolve) => (reachedMic = resolve));
      const h = harness({
        openMicrophone: () => {
          reachedMic();
          return new Promise<FakeMediaStream>((resolve) => (releaseMic = resolve));
        },
      });

      const started = h.session.start(startOptions);
      expect(h.statuses.at(-1)).toBe('connecting');

      // The microphone prompt is the one step here that waits on a human, and
      // it is asked for right after the worklet loads — before the socket
      // even exists — so this is the window the press actually has to reach.
      await atMic;

      h.session.finish();
      expect(h.statuses.at(-1)).toBe('idle');

      // The prompt is answered after the press, which is the ordinary order —
      // it waits for a human, and the press is what the human did first.
      releaseMic(stream);
      await started;

      expect(h.session.isRunning).toBe(false);
      expect(h.statuses).not.toContain('listening');
      // The abandoned run gives back the microphone it was waiting on. It
      // never got as far as a socket, so there is none to give back.
      expect(stream.tracks[0]!.stopped).toBe(1);
      expect(h.sockets).toHaveLength(0);
    });

    it('refuses to pause a conversation that is already ending', async () => {
      const h = harness(continuous);
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.finish();
      h.statuses.length = 0;
      h.session.pause();

      expect(h.statuses).toEqual([]);
      expect(h.session.isPaused).toBe(false);
    });
  });

  describe('teardown', () => {
    // The first stale checkpoint. Nothing past the context exists yet — the
    // microphone is not asked for until the worklet module has loaded, and the
    // socket does not exist until after that — so a run stopped here gives
    // back only the context.
    it('closes only the context when stopped while the worklet module is still loading', async () => {
      let reachedModule!: () => void;
      const atModule = new Promise<void>((resolve) => (reachedModule = resolve));
      let releaseModule!: () => void;

      const h = harness({
        addModule: () => {
          reachedModule();
          return new Promise<void>((resolve) => (releaseModule = resolve));
        },
      });

      const started = h.session.start(startOptions);
      await atModule;
      h.session.stop();
      releaseModule();
      await started;

      // Neither the microphone nor the socket had been asked for yet.
      expect(h.sockets).toHaveLength(0);
      expect(h.stream.tracks[0]!.stopped).toBe(0);
      expect(h.context.closed).toBe(1);
    });

    // The second stale checkpoint. The microphone permission prompt is
    // showing, but the socket — created only once the microphone resolves —
    // still does not exist.
    it('releases the microphone and the context when stopped while the microphone permission is pending', async () => {
      let reachedMic!: () => void;
      const atMic = new Promise<void>((resolve) => (reachedMic = resolve));
      let releaseMic!: (stream: FakeMediaStream) => void;
      const stream = new FakeMediaStream();

      const h = harness({
        openMicrophone: () => {
          reachedMic();
          return new Promise<FakeMediaStream>((resolve) => (releaseMic = resolve));
        },
      });

      const started = h.session.start(startOptions);
      await atMic;
      h.session.stop();
      releaseMic(stream);
      await started;

      expect(stream.tracks[0]!.stopped).toBe(1);
      expect(h.sockets).toHaveLength(0);
      expect(h.context.closed).toBe(1);
    });

    // The third and last stale checkpoint, and the one the reorder moved here
    // on purpose: by the time the socket is connecting, the microphone is
    // already open and its worklet edge already wired, so a run superseded
    // here must give back all three — the live microphone edge included —
    // not just the socket and the context.
    it('releases the microphone, the socket and the context when stopped while the socket is still connecting', async () => {
      let reachedConnect!: () => void;
      const atConnect = new Promise<void>((resolve) => (reachedConnect = resolve));
      let releaseConnect!: () => void;

      class SlowSocket extends FakeTranslateSocket {
        override connect(): Promise<void> {
          reachedConnect();
          return new Promise<void>((resolve) => (releaseConnect = resolve));
        }
      }

      const h = harness({ createSocket: (handlers) => new SlowSocket(handlers) });

      const started = h.session.start(startOptions);
      await atConnect;
      h.session.stop();
      releaseConnect();
      await started;

      expect(h.socket().closed).toBe(1);
      expect(h.stream.tracks[0]!.stopped).toBe(1);
      expect(h.context.closed).toBe(1);
      // The worklet edge feeding it, wired the moment the microphone resolved.
      expect(h.context.disconnectedSources).toBe(1);
    });

    it('survives being stopped twice without releasing anything again', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.session.stop();
      expect(() => h.session.stop()).not.toThrow();

      expect(h.stream.tracks[0]!.stopped).toBe(1);
      expect(h.context.closed).toBe(1);
    });

    // A stale start must release only what it built. Resetting the shared state
    // would blank the id of the run already in progress, after which every block
    // lands in `pending` and is never flushed: microphone open, meter moving,
    // nothing reaching the server and no error anywhere.
    it('does not let a stale start wipe the run that replaced it', async () => {
      const streams = [new FakeMediaStream(), new FakeMediaStream()];
      let releaseFirst!: (stream: FakeMediaStream) => void;
      let reachedFirstMic!: () => void;
      const atFirstMic = new Promise<void>((resolve) => (reachedFirstMic = resolve));
      let call = 0;
      const h = harness({
        openMicrophone: () => {
          call += 1;
          if (call === 1) {
            reachedFirstMic();
            return new Promise<FakeMediaStream>((resolve) => (releaseFirst = resolve));
          }
          return Promise.resolve(streams[1]!);
        },
      });

      // The microphone is asked for right after the worklet loads, before the
      // socket even exists, so the first run only has to be let as far as its
      // own context before it can be superseded there.
      const first = h.session.start(startOptions);
      await atFirstMic;
      h.session.stop();
      await h.session.start(startOptions);

      h.talk();
      h.socket().emit(readyEvent('s2'));
      const before = h.socket().audioFrames.length;
      expect(before).toBeGreaterThan(0);

      // The abandoned run finally gets its microphone.
      releaseFirst(streams[0]!);
      await first;

      h.talk(4);
      const after = h.socket().audioFrames.length;
      expect(after).toBeGreaterThan(before);
      expect(streams[0]!.tracks[0]!.stopped).toBe(1);
    });

    // The same stale run, failing instead of succeeding. Every checkpoint on the
    // way down `start()` asks whether it still owns the run; the error path did
    // not, so a microphone the user refused *after* moving on tore down the run
    // they had moved on to — and blamed it for a permission prompt it never
    // raised. Late refusals are ordinary: the prompt waits for a human.
    it('does not let a failing stale start tear down the run that replaced it', async () => {
      let refuseFirst!: (reason: Error) => void;
      let reachedFirstMic!: () => void;
      const atFirstMic = new Promise<void>((resolve) => (reachedFirstMic = resolve));
      let call = 0;
      const h = harness({
        openMicrophone: () => {
          call += 1;
          if (call === 1) {
            reachedFirstMic();
            return new Promise<FakeMediaStream>((_, reject) => (refuseFirst = reject));
          }
          return Promise.resolve(new FakeMediaStream());
        },
      });

      const first = h.session.start(startOptions);
      await atFirstMic;
      h.session.stop();
      await h.session.start(startOptions);

      h.talk();
      h.socket().emit(readyEvent('s2'));
      const before = h.socket().audioFrames.length;
      expect(before).toBeGreaterThan(0);

      // The abandoned run's microphone request is finally refused.
      refuseFirst(new Error('Permission denied'));
      await first;

      expect(h.session.isRunning).toBe(true);
      h.talk(4);
      expect(h.socket().audioFrames.length).toBeGreaterThan(before);
      // Nor may it put its own failure in front of a conversation that is fine.
      expect(h.errors).not.toContain('Permission denied');
    });
  });

  /**
   * The two headline numbers of continuous capture — capture coverage and how far
   * the translation drifts behind the speaker — exist only here. The server cannot
   * know when someone started speaking or when a loudspeaker made a sound.
   */
  describe('reporting turn metrics', () => {
    const metricsOf = (h: ReturnType<typeof harness>) =>
      h
        .socket()
        .sent.filter((e) => e.type === 'client.turn.metrics')
        .map((e) => e.metrics!);

    it('says nothing unless asked to', async () => {
      const h = harness();
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      h.socket().emit(endedEvent());

      expect(metricsOf(h)).toHaveLength(0);
    });

    it('files a row when the turn closes', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.socket().emit(endedEvent());

      const rows = metricsOf(h);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ sessionId: 's1', outcome: 'played' });
      expect(rows[0]!.capturedMs).toBeGreaterThan(0);
      expect(rows[0]!.speechStartedAt).toBeGreaterThan(0);
      expect(rows[0]!.firstAudioPlayedAt).toBeGreaterThan(0);
    });

    /**
     * The plan's sharpest point about this channel. A turn refused at the ceiling,
     * dropped, or failed never produces audio — so filing rows only when a turn
     * finishes PLAYING would omit exactly those turns. Coverage would then measure
     * the success rate of playback rather than the coverage of capture, and would
     * look its best at the moment the pipeline was at its worst.
     */
    it('files a row for a turn that failed and never played', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();
      h.socket().emit(readyEvent('s1'));

      h.socket().emit({
        type: 'server.error',
        code: 'turn_failed',
        message: 'Translation failed',
        sessionId: 's1',
      });

      const rows = metricsOf(h);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'error', sessionId: 's1' });
      expect(rows[0]!.firstAudioPlayedAt).toBeUndefined();
      // The captured audio still counts towards coverage: it was captured.
      expect(rows[0]!.capturedMs).toBeGreaterThan(0);
    });

    it('reports a turn that ended carrying no audio as no_audio', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();
      h.socket().emit(readyEvent('s1'));

      h.socket().emit({
        type: 'server.session.ended',
        reason: 'no_audio',
        sessionId: 's1',
      });

      expect(metricsOf(h)[0]).toMatchObject({ outcome: 'no_audio' });
    });

    /**
     * `voice_off` is the server's word for a turn that SUCCEEDED and was never
     * meant to be spoken — `turn-timeline.ts` says so in those terms. It reached
     * `outcomeFor`'s unknown-reason fall-through and was filed as `error`, so
     * every text-only turn looked like a failure. Measured in production on
     * 2026-08-31: 21 of 21 client rows said `error` while the server said
     * `completed: true` for 16 of 17.
     */
    it('reports a turn ended with voice off as no_audio, not error', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();
      h.socket().emit(readyEvent('s1'));

      h.socket().emit({
        type: 'server.session.ended',
        reason: 'voice_off',
        sessionId: 's1',
      });

      expect(metricsOf(h)[0]).toMatchObject({ outcome: 'no_audio' });
    });

    /**
     * The listener was there and heard less than the whole turn. A delivery
     * failure, not a turn failure — the translation itself completed.
     */
    it('reports unsupported audio as dropped, not error', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();
      h.socket().emit(readyEvent('s1'));

      h.socket().emit({
        type: 'server.session.ended',
        reason: 'unsupported_audio',
        sessionId: 's1',
      });

      expect(metricsOf(h)[0]).toMatchObject({ outcome: 'dropped' });
    });

    /**
     * `idle_timeout` STAYS an error, and is named so that it is a decision
     * rather than the fall-through catching it by accident. The server pairs it
     * with a `turn_abandoned` failure.
     */
    it('reports an idle timeout as error, named rather than defaulted', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();
      h.socket().emit(readyEvent('s1'));

      h.socket().emit({
        type: 'server.session.ended',
        reason: 'idle_timeout',
        sessionId: 's1',
      });

      expect(metricsOf(h)[0]).toMatchObject({ outcome: 'error' });
    });

    /**
     * The fall-through must survive. `server.session.ended.reason` is
     * `z.string()` on the wire, so a reason this client has never heard of is
     * always possible and must not be filed as a success.
     */
    it('still files an unrecognised reason as error', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();
      h.socket().emit(readyEvent('s1'));

      h.socket().emit({
        type: 'server.session.ended',
        reason: 'something_this_client_predates',
        sessionId: 's1',
      });

      expect(metricsOf(h)[0]).toMatchObject({ outcome: 'error' });
    });

    // A turn cut at the length ceiling ends mid-sentence, so its translation is
    // missing context the next turn carries. The row has to say which kind of turn
    // it was rather than leaving that quality drop looking like a pipeline fault.
    it('marks a turn the ceiling cut', async () => {
      const h = harness({
        runtime: { reportMetrics: true, continuous: true, fullDuplex: true, maxUtteranceMs: 2000 },
      });
      await h.session.start(startOptions);

      // Talk past the ceiling with no pause anywhere.
      h.talk(200);
      h.socket().emit(readyEvent('s1'));
      h.socket().emit({
        type: 'server.session.ended',
        reason: 'completed',
        sessionId: 's1',
      });

      const rows = metricsOf(h);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.cutForced)).toBe(true);
    });

    // A turn that never reached the server has no id to file a row against, and
    // the server keys and validates rows by its own id.
    it('files nothing for a turn with no server id', async () => {
      const h = harness({ runtime: { reportMetrics: true } });
      await h.session.start(startOptions);
      h.talk();
      h.hush();

      // No `ready` ever arrives; the conversation is torn down instead.
      h.session.stop();

      expect(metricsOf(h)).toHaveLength(0);
    });
  });

  describe('full duplex', () => {
    // Read through a getter rather than captured once: the flag exists to be
    // toggled between runs while measuring echo, and a value frozen at
    // construction would ignore every toggle after the first.
    it('reads the flag afresh at each start', async () => {
      let allowed = false;
      const reads: boolean[] = [];
      const h = harness({
        runtimeOptions: () => {
          reads.push(allowed);
          return { fullDuplex: allowed };
        },
      });

      await h.session.start(startOptions);
      h.session.stop();
      allowed = true;
      await h.session.start(startOptions);

      expect(reads).toEqual([false, true]);
    });
  });

  describe('start guard', () => {
    it('ignores a second start while one is already running', async () => {
      let opened = 0;
      const stream = new FakeMediaStream();
      const h = harness({
        openMicrophone: () => {
          opened += 1;
          return Promise.resolve(stream);
        },
      });

      await h.session.start(startOptions);
      h.listeners.onReset.mockClear();
      await h.session.start(startOptions);

      expect(opened).toBe(1);
      // A reset here would blank the transcript in front of the speaker.
      expect(h.listeners.onReset).not.toHaveBeenCalled();
    });
  });

  /**
   * `apps/web` attaches its `MediaRecorder` inside `openMicrophone` (see
   * `use-conversation-recording.ts`), so whatever this class does BEFORE that
   * call is a window during which speech is recorded but never reaches the
   * capture pump — the recording and the transcript then disagree about how
   * the conversation started. Asking for the microphone only once the
   * worklet has loaded is what closes that window.
   *
   * Waiting for the SOCKET as well, before wiring capture, used to close a
   * second window one step later instead of removing it: capture then went
   * live only once the handshake finished, so anything said while it was in
   * flight reached neither the recording nor the transcript. Capture is now
   * wired the instant the microphone resolves — before the socket even starts
   * connecting — and `describe('capture buffered before the socket
   * connects')` below is what that audio does from there.
   */
  describe('startup ordering', () => {
    class OrderedSocket extends FakeTranslateSocket {
      constructor(
        handlers: TranslateSocketHandlers,
        private readonly order: string[],
        private readonly captureIsLive: () => boolean,
      ) {
        super(handlers);
      }
      override connect(): Promise<void> {
        this.order.push(
          this.captureIsLive() ? 'socket.connect (capture already live)' : 'socket.connect',
        );
        return super.connect();
      }
    }

    it('asks for the microphone only after the worklet has loaded, and wires capture before the socket connects', async () => {
      const order: string[] = [];
      const h = harness({
        addModule: () => {
          order.push('worklet.addModule');
          return Promise.resolve();
        },
        createSocket: (handlers) =>
          new OrderedSocket(handlers, order, () => h.node.port.onmessage !== null),
        openMicrophone: () => {
          order.push('openMicrophone');
          return Promise.resolve(new FakeMediaStream());
        },
      });

      await h.session.start(startOptions);

      // Fails against the ordering this replaces, which connected the socket
      // before ever asking for the microphone, and fails just as hard against
      // an ordering that asks for the microphone first but wires capture only
      // once the socket answers.
      expect(order).toEqual([
        'worklet.addModule',
        'openMicrophone',
        'socket.connect (capture already live)',
      ]);
    });
  });

  /**
   * Wiring capture before the socket connects (above) closes the recorder
   * gap, but opens a narrower one of its own: audio captured while the
   * handshake is still in flight has nowhere to go yet, because the pipeline
   * that turns blocks into `client.audio.frame` events does not exist until
   * the socket answers. This is what proves that audio is held rather than
   * dropped, and reaches the pipeline in order once it is built.
   */
  describe('capture buffered before the socket connects', () => {
    class DeferredSocket extends FakeTranslateSocket {
      private resolver: (() => void) | null = null;

      override connect(): Promise<void> {
        this.connectCalls += 1;
        return new Promise<void>((resolve) => {
          this.resolver = resolve;
        });
      }

      /** Answer the handshake the test has been holding open. */
      finishConnect(): void {
        this.resolver?.();
        this.resolver = null;
      }
    }

    it('replays audio captured before the handshake into the pipeline, in order, once it is live', async () => {
      let deferred: DeferredSocket | undefined;
      const h = harness({
        createSocket: (handlers) => {
          deferred = new DeferredSocket(handlers);
          return deferred;
        },
      });

      const startPromise = h.session.start(startOptions);
      // Past `addModule` and `openMicrophone` — both resolve immediately in
      // this harness — and now blocked on the socket connect this test is
      // holding open. Capture is already wired at this point: nothing
      // delivered from here has anywhere real to go, but nothing is lost.
      await flushMicrotasks();
      h.talk();

      // Fails against the code this replaces: there, capture is not wired
      // until the socket has already connected, so this speech would already
      // be gone rather than merely waiting.
      expect(h.socket().sent).toHaveLength(0);

      deferred!.finishConnect();
      await startPromise;

      // The buffered speech reached the gate exactly as if the pipeline had
      // already existed when it arrived: a turn opened for it.
      expect(h.socket().sent.map((e) => e.type)).toContain('client.session.start');
      h.socket().emit(readyEvent('s1'));
      const frames = h.socket().audioFrames;
      expect(frames.length).toBeGreaterThan(0);
      // Contiguous from zero, the same check `describe('audio captured before
      // the handshake lands')` uses — a gap or a duplicate here would mean the
      // replay lost a block or sent one twice.
      expect(frames.map((f) => f.sequence)).toEqual(frames.map((_, index) => index));
    });
  });

  describe('failures', () => {
    it('reports a startup failure and lets go of what it had opened', async () => {
      const h = harness({
        createSocket: () => {
          throw new Error('Cannot reach the translator');
        },
      });

      await h.session.start(startOptions);

      expect(h.errors).toContain('Cannot reach the translator');
      // The microphone is asked for before the socket exists at all now, so a
      // socket that fails to even construct still has to give back what was
      // already open rather than leaving it running.
      expect(h.stream.tracks[0]!.stopped).toBe(1);
      expect(h.context.closed).toBeGreaterThan(0);
    });

    // Teardown deliberately does not clear the error: without it the user drops
    // back to idle with no explanation for why the conversation stopped.
    it('keeps the dropped-connection message after teardown', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.socket().drop();

      expect(h.errors[h.errors.length - 1]).toBe('Connection to the translator dropped');
      expect(h.statuses[h.statuses.length - 1]).toBe('idle');
    });
  });

  describe('server events', () => {
    it('forwards every event to the listener that owns the transcript', async () => {
      const h = harness();
      await h.session.start(startOptions);

      const segment: TranscriptSegment = {
        id: 'seg-1',
        sessionId: 's1',
        speakerRole: 'speaker_a',
        direction: 'vi_to_en',
        sourceText: 'xin chào',
        targetText: 'hello',
        audioUrl: null,
        createdAt: new Date().toISOString(),
      };
      const event: ServerEvent = {
        type: 'server.transcript.final',
        sessionId: 's1',
        segment,
      };
      h.socket().emit(event);

      expect(h.listeners.onServerEvent).toHaveBeenCalledWith(event);
    });

    it('surfaces a server error message', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.socket().emit({
        type: 'server.error',
        code: 'turn_failed',
        message: 'No speech detected',
      });

      expect(h.errors).toContain('No speech detected');
    });
  });

  describe('an injected playback sink', () => {
    it('receives the turn audio instead of the loudspeakers', async () => {
      let sink: RecordingSink | undefined;
      const h = harness({ sink: (s) => (sink = s) });
      await h.session.start(startOptions);

      openTurnAndPlay(h);

      expect(sink!.enqueued).toHaveLength(1);
      expect(sink!.enqueued[0]!.sampleRate).toBe(24000);
      // The default queue schedules a buffer source per chunk on the context;
      // an injected sink means none was ever created.
      expect(h.context.sources).toHaveLength(0);
    });

    it('drives the re-arm through the sink’s own drain report', async () => {
      // The whole point of passing `onTurnDrained` in: a sink somewhere else
      // cannot be observed on this machine's audio clock, so its report is the
      // only thing that can retire the turn. Without the wiring, the microphone
      // stays shut for the rest of the conversation.
      let sink: RecordingSink | undefined;
      const h = harness({ sink: (s) => (sink = s) });
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      h.socket().emit(endedEvent());
      h.statuses.length = 0;
      h.listeners.onMuted.mockClear();

      sink!.drain(sink!.onlyTurnKey);

      expect(h.statuses).toEqual(['listening']);
      expect(h.listeners.onMuted).toHaveBeenCalledWith(false);
    });

    it('is stopped when the run tears down', async () => {
      let sink: RecordingSink | undefined;
      const h = harness({ sink: (s) => (sink = s) });
      await h.session.start(startOptions);
      openTurnAndPlay(h);

      h.session.stop();

      expect(sink!.isPlaying).toBe(false);
    });
  });

  describe('what the microphone gate is keyed on', () => {
    /**
     * The signal has to be "audio is audible now", not "a turn exists".
     *
     * `OrderedPlayback.isBusy` — what `onPlaybackBusy` carries — is true from the
     * moment a turn OPENS, which is when someone starts talking, and stays true
     * until it has both closed server-side and drained. Wire the gate to that and
     * the microphone is shut for as long as any turn is in flight; with three of
     * them it never reopens, and in a quiet room every test still passes.
     */
    it('keeps capturing while turns are in flight but nothing is sounding', async () => {
      let sink: RecordingSink | undefined;
      const h = harness({
        runtime: { continuous: true, maxInFlight: 3 },
        sink: (s) => {
          sink = s;
        },
      });
      await h.session.start(startOptions);

      // Three turns opened and never answered: `isBusy` is true throughout,
      // `isPlaying` is false because no audio ever arrived.
      for (let i = 0; i < 3; i += 1) {
        h.talk();
        h.hush();
      }

      expect(sink!.isPlaying).toBe(false);
      const starts = h.socket().sent.filter((event) => event.type === 'client.session.start');
      expect(starts.length).toBe(3);
    });

    /**
     * `continuous` and `maxInFlight` are not two free settings.
     *
     * `armNextTurn()` is the only exit from `awaiting-result` and is only ever
     * called on the single-turn path, so this combination used to park the
     * microphone there with nobody to release it — dead for the rest of the
     * conversation, reporting nothing.
     */
    it('will not run several turns in flight without continuous capture', async () => {
      const h = harness({ runtime: { continuous: false, maxInFlight: 3 } });
      await h.session.start(startOptions);

      h.talk();
      h.hush(); // turn one ends
      h.talk();
      h.hush(); // and the microphone must still be listening for turn two

      const starts = h.socket().sent.filter((event) => event.type === 'client.session.start');
      expect(starts.length).toBe(2);
    });
  });

  describe('who owns the echo measurement', () => {
    /**
     * A caller whose echo appears somewhere the pump's microphone is not.
     *
     * The extension is that caller: its pump is fed the CAPTURED TAB — the other
     * participants — while the translation plays through an offscreen document.
     * Counting what the pump hears during playback would file every remote
     * speaker talking over our audio into `echoEvents` as echo, in an app where
     * the digital loop cannot exist by construction and a dedicated microphone
     * already produces that number.
     */
    it('leaves echo counting to the caller that owns it', async () => {
      let sink: RecordingSink | undefined;
      const h = harness({
        runtime: {
          continuous: true,
          fullDuplex: true,
          maxInFlight: 3,
          ownsEchoMeasurement: true,
        },
        sink: (s) => {
          sink = s;
        },
      });
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      expect(sink!.isPlaying).toBe(true);

      h.talk(); // the meeting carries on while our translation plays

      expect(h.listeners.onEchoHeard).not.toHaveBeenCalled();
    });

    it('counts it in the pump when nobody else does', async () => {
      let sink: RecordingSink | undefined;
      const h = harness({
        runtime: { continuous: true, fullDuplex: true, maxInFlight: 3 },
        sink: (s) => {
          sink = s;
        },
      });
      await h.session.start(startOptions);
      openTurnAndPlay(h);
      expect(sink!.isPlaying).toBe(true);

      h.talk();

      expect(h.listeners.onEchoHeard).toHaveBeenCalled();
    });
  });

  describe('teardown of a context this session does not own', () => {
    // Disconnecting the worklet severs its outputs only. The microphone edge
    // feeding it is what keeps it running — and posting a block every ~21ms —
    // for as long as the context lives, which with `ownsAudioResources: false`
    // is longer than the session.
    it('cuts the microphone edge into the worklet', async () => {
      const h = harness();
      await h.session.start(startOptions);

      h.session.stop();

      expect(h.context.disconnectedSources).toBe(1);
    });
  });
});

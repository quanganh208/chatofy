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

interface HarnessOptions {
  openMicrophone?: () => Promise<FakeMediaStream>;
  createSocket?: (handlers: TranslateSocketHandlers) => FakeTranslateSocket;
  addModule?: (url: string) => Promise<void>;
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

  describe('teardown', () => {
    it('releases the microphone when stopped before the context exists', async () => {
      let releaseMic!: (stream: FakeMediaStream) => void;
      const stream = new FakeMediaStream();
      const h = harness({
        openMicrophone: () => new Promise<FakeMediaStream>((resolve) => (releaseMic = resolve)),
      });

      const started = h.session.start(startOptions);
      h.session.stop();
      releaseMic(stream);
      await started;

      expect(stream.tracks[0]!.stopped).toBe(1);
      // The context was never built, so nothing should have tried to close one.
      expect(h.context.closed).toBe(0);
    });

    it('releases microphone and context when stopped after the worklet loaded', async () => {
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

      expect(h.stream.tracks[0]!.stopped).toBe(1);
      expect(h.context.closed).toBe(1);
    });

    // The third and last stale checkpoint. By here a socket is connected, and
    // dropping the run without closing it leaves a live connection nobody holds.
    it('closes the socket when stopped after it had already connected', async () => {
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
      let call = 0;
      const h = harness({
        openMicrophone: () => {
          call += 1;
          if (call === 1) {
            return new Promise<FakeMediaStream>((resolve) => (releaseFirst = resolve));
          }
          return Promise.resolve(streams[1]!);
        },
      });

      const first = h.session.start(startOptions);
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
      let call = 0;
      const h = harness({
        openMicrophone: () => {
          call += 1;
          if (call === 1) {
            return new Promise<FakeMediaStream>((_, reject) => (refuseFirst = reject));
          }
          return Promise.resolve(new FakeMediaStream());
        },
      });

      const first = h.session.start(startOptions);
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

  describe('failures', () => {
    it('reports a startup failure and lets go of what it had opened', async () => {
      const h = harness({
        createSocket: () => {
          throw new Error('Cannot reach the translator');
        },
      });

      await h.session.start(startOptions);

      expect(h.errors).toContain('Cannot reach the translator');
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
});

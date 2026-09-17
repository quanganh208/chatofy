import { describe, expect, it, vi } from 'vitest';
import type { PlaybackSink } from '@chatofy/realtime-client';
import type { LiveClientEvent, LiveServerEvent } from '@chatofy/types';
import type { DirectionSessionDeps } from './direction-session';
import { LiveDirectionSession, type LiveDirectionBrowser } from './live-direction-session';
import type { CaptureSettings } from './messages';

/**
 * The continuous direction, wired into a meeting.
 *
 * What is tested here is the wiring only this class decides: which signal the
 * duck follows, whether a teardown reports itself back, and what the transcript
 * is keyed by. `LiveSession`, `MicrophoneGraph` and `SoundingSink` are each
 * driven by their own suites and are not re-tested through this one.
 */

/** A socket a test can push server events through. */
class FakeSocket {
  readonly sent: LiveClientEvent[] = [];
  closed = 0;
  constructor(readonly handlers: { onEvent: (event: LiveServerEvent) => void }) {}
  connect(): Promise<void> {
    return Promise.resolve();
  }
  start(direction: 'vi_to_en' | 'en_to_vi'): void {
    this.sent.push({ type: 'client.live.start', direction });
  }
  sendAudio(): void {}
  stop(): void {
    this.sent.push({ type: 'client.live.stop' });
  }
  close(): void {
    this.closed += 1;
  }
  /** Push one event the way the backend would. */
  emit(event: LiveServerEvent): void {
    this.handlers.onEvent(event);
  }
}

/** A playback leaf whose "is it sounding" answer a test controls outright. */
class FakeQueue implements PlaybackSink {
  playing = false;
  stopped = 0;
  readonly enqueued: string[] = [];
  constructor(private readonly onDrained: () => void) {}
  enqueue(turnKey: string): void {
    this.enqueued.push(turnKey);
    this.playing = true;
  }
  isPlayingTurn(): boolean {
    return this.playing;
  }
  get isPlaying(): boolean {
    return this.playing;
  }
  stop(): void {
    this.stopped += 1;
    this.playing = false;
  }
  stopTurn(): void {}
  /** The leaf announcing its own drain, which is what makes the flip visible. */
  drain(): void {
    this.playing = false;
    this.onDrained();
  }
}

const settings = (overrides: Partial<CaptureSettings> = {}): CaptureSettings => ({
  direction: 'en_to_vi',
  mode: 'live',
  voiceGender: 'female',
  apiBaseUrl: 'http://localhost:3000',
  reportMetrics: false,
  outbound: false,
  ...overrides,
});

function harness(overrides: Partial<DirectionSessionDeps> = {}) {
  const events: Parameters<DirectionSessionDeps['onServerEvent']>[0][] = [];
  const busy: boolean[] = [];
  const sounding: boolean[] = [];
  const stopped = vi.fn();
  const errors: string[] = [];

  let socket: FakeSocket | undefined;
  let queue: FakeQueue | undefined;
  const node = { port: { onmessage: null }, disconnect: () => {} };
  const context = {
    audioWorklet: { addModule: () => Promise.resolve() },
    createMediaStreamSource: () => ({ connect: () => {} }),
    sampleRate: 48000,
    close: () => Promise.resolve(),
  };

  const deps: DirectionSessionDeps = {
    context: context as unknown as AudioContext,
    accessToken: 'test-access-token',
    workletUrl: '/worklets/mic-capture-processor.js',
    settings: settings(),
    direction: 'en_to_vi',
    input: { getTracks: () => [] } as unknown as MediaStream,
    maxInFlight: 1,
    onServerEvent: (event) => events.push(event),
    onReset: () => {},
    onTurnAbandoned: () => {},
    onError: (message) => errors.push(message ?? ''),
    onBusy: (value) => busy.push(value),
    onSounding: (value) => sounding.push(value),
    onStopped: stopped,
    onLog: () => {},
    ...overrides,
  };

  const browser: LiveDirectionBrowser = {
    createWorkletNode: () => node as unknown as AudioWorkletNode,
    createSocket: (handlers) => {
      socket = new FakeSocket(handlers);
      return socket as never;
    },
    createQueue: (_context, onDrained) => {
      queue = new FakeQueue(onDrained);
      return queue;
    },
  };

  const session = new LiveDirectionSession(deps, browser);
  return {
    session,
    events,
    busy,
    sounding,
    stopped,
    errors,
    get socket() {
      if (!socket) throw new Error('the session has not opened a socket yet');
      return socket;
    },
    get queue() {
      if (!queue) throw new Error('the session has not built a queue yet');
      return queue;
    },
  };
}

const audio = (): LiveServerEvent => ({
  type: 'server.live.audio',
  frame: {
    sessionId: 'live',
    encoding: 'pcm16',
    sampleRate: 24000,
    sequence: 0,
    timestamp: 0,
    // Two samples of silence. The content is irrelevant; that it reaches the
    // queue at all is the thing being asserted.
    payload: 'AAAAAA==',
  },
});

describe('LiveDirectionSession', () => {
  describe('the ducking signal', () => {
    it('reports audible audio as BUSY as well as sounding', async () => {
      // The cascade ducks on `OrderedPlayback.isBusy`, which counts turns still
      // waiting. There are no turns here, so that signal would never rise and
      // the meeting would never duck at all. Audible audio is the only edge
      // this backend has.
      const h = harness();
      await h.session.start({ direction: 'en_to_vi' });
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

      h.socket.emit(audio());

      expect(h.busy).toEqual([true]);
      expect(h.sounding).toEqual([true]);
    });

    it('releases both when the queue drains', async () => {
      const h = harness();
      await h.session.start({ direction: 'en_to_vi' });
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });
      h.socket.emit(audio());

      h.queue.drain();

      // Falling as well as rising: a duck that is never released leaves the
      // meeting at a fifth of its volume for the rest of the call.
      expect(h.busy).toEqual([true, false]);
      expect(h.sounding).toEqual([true, false]);
    });
  });

  describe('transcript', () => {
    it('appends deltas under a key that names the direction', async () => {
      const h = harness();
      await h.session.start({ direction: 'en_to_vi' });
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

      h.socket.emit({
        type: 'server.live.transcript',
        sessionId: 's1',
        channel: 'source',
        delta: 'hello',
        lang: 'en',
      });

      expect(h.events).toEqual([
        {
          type: 'transcript.liveDelta',
          sessionId: 'live:en_to_vi',
          channel: 'source',
          delta: 'hello',
        },
      ]);
    });

    it('keys the two directions apart, so one cannot overwrite the other', async () => {
      // `MeetingTranscript` orders both directions through one `firstSeen` map
      // keyed by this id, and both live sessions run for the whole meeting. A
      // shared key would merge the meeting and the user into one line.
      const said = async (direction: 'en_to_vi' | 'vi_to_en') => {
        const h = harness({ direction });
        await h.session.start({ direction });
        h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });
        h.socket.emit({
          type: 'server.live.transcript',
          sessionId: 's1',
          channel: 'source',
          delta: 'x',
          lang: 'en',
        });
        const event = h.events[0]!;
        // Narrowed rather than cast: if this direction ever stopped emitting a
        // live delta, the test should say so instead of comparing undefined.
        if (event.type !== 'transcript.liveDelta') throw new Error(`got ${event.type}`);
        return event.sessionId;
      };

      expect(await said('en_to_vi')).not.toBe(await said('vi_to_en'));
    });
  });

  describe('teardown', () => {
    it('does NOT report a stop it was asked for', async () => {
      // `MeetingCapture.stopDirection` clears its slot before calling stop, and
      // the inbound direction's `onStopped` tears the whole capture down.
      // Reporting here would re-enter a teardown already in progress.
      const h = harness();
      await h.session.start({ direction: 'en_to_vi' });
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

      h.session.stop();

      expect(h.stopped).not.toHaveBeenCalled();
    });

    it('closes the socket at once rather than draining it', async () => {
      // The shared context closes moments after a stop, so trailing audio has
      // nowhere left to play — and a socket held open for it would keep a
      // metered upstream session alive with nothing able to reach it.
      const h = harness();
      await h.session.start({ direction: 'en_to_vi' });
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

      h.session.stop();

      expect(h.socket.closed).toBe(1);
      expect(h.queue.stopped).toBe(1);
    });

    it('DOES report an end the server decided', async () => {
      const h = harness();
      await h.session.start({ direction: 'en_to_vi' });
      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });

      h.socket.emit({ type: 'server.live.ended', sessionId: 's1', reason: 'idle' });

      expect(h.stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('hints', () => {
    // This backend's socket protocol takes no hint parameter, so there is
    // nothing to forward `hints` to. Accepting and ignoring it is what keeps
    // one `DirectionRunner` shape across both backends — the same treatment
    // `voiceGender` already gets.
    it('the live backend ignores hints without failing', async () => {
      const h = harness();
      await expect(
        h.session.start({ direction: 'en_to_vi', hints: { topic: 'cardiology consult' } }),
      ).resolves.toBeUndefined();

      h.socket.emit({ type: 'server.live.ready', sessionId: 's1' });
      h.socket.emit(audio());

      expect(h.errors).toEqual([]);
      expect(h.sounding).toEqual([true]);
    });
  });

  it('surfaces an upstream failure to the direction that owns it', async () => {
    const h = harness();
    await h.session.start({ direction: 'en_to_vi' });

    h.socket.emit({ type: 'server.live.error', code: 'bad_key', message: 'rejected' });

    expect(h.errors).toEqual(['bad_key: rejected']);
  });
});

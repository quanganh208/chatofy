import type { ClientTurnMetrics, ServerEvent, TranslationDirection } from '@chatofy/types';
import type { TranslateSocketHandlers } from '../transport/translate-socket.js';

/**
 * Test doubles for everything `ConversationSession` reaches for.
 *
 * The vitest suite runs under `environment: 'node'` on purpose — the turn-taking
 * policy, resampling and framing are all deliberately free of the DOM, and this
 * file is what keeps it that way for the lifecycle class too. Every surface here
 * exists because the session actually touches it; nothing is speculative.
 */

export class FakeTrack {
  stopped = 0;
  stop(): void {
    this.stopped += 1;
  }
}

export class FakeMediaStream {
  readonly tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

export class FakeBufferSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  started: number | null = null;
  stopped = false;

  connect(): void {}
  start(when: number): void {
    this.started = when;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeWorkletNode {
  readonly port: { onmessage: ((event: { data: Float32Array }) => void) | null } = {
    onmessage: null,
  };
  disconnected = 0;

  disconnect(): void {
    this.disconnected += 1;
  }

  /** Deliver one block of microphone audio, as the real worklet would. */
  deliver(samples: Float32Array): void {
    this.port.onmessage?.({ data: samples });
  }
}

export class FakeAudioContext {
  /**
   * Load-bearing: the session sizes every capture block from this, so a missing
   * rate turns the block size into NaN and the pump silently stops confirming
   * speech. 48 kHz is what browsers actually capture at.
   */
  readonly sampleRate = 48000;
  currentTime = 0;
  readonly destination = {};
  closed = 0;
  /** Microphone edges released on teardown — the worklet keeps running without. */
  disconnectedSources = 0;
  readonly sources: FakeBufferSource[] = [];
  readonly addedModules: string[] = [];

  readonly audioWorklet = {
    addModule: (url: string): Promise<void> => {
      this.addedModules.push(url);
      return Promise.resolve();
    },
  };

  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      duration: length / sampleRate,
      getChannelData: () => data,
    };
  }

  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }

  createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
    const source = {
      connect: () => {},
      disconnect: () => {
        this.disconnectedSources += 1;
      },
    };
    return source;
  }

  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }

  /**
   * Fire `onended` for everything queued.
   *
   * Without this the playback queue never empties, so the microphone would never
   * be re-armed and half the re-arm tests would pass for the wrong reason.
   */
  flushEnded(): void {
    for (const source of [...this.sources]) {
      const ended = source.onended;
      source.onended = null;
      ended?.();
    }
  }
}

/** One `client.*` event the session pushed at the server. */
export interface SentEvent {
  type: string;
  sessionId?: string;
  /** The client's name for the turn, on the events that carry one. */
  turnId?: string;
  sequence?: number;
  payload?: string;
  direction?: TranslationDirection;
  /** The whole row, for the one event that carries measurements. */
  metrics?: ClientTurnMetrics;
}

export class FakeTranslateSocket {
  readonly sent: SentEvent[] = [];
  closed = 0;
  connectCalls = 0;

  constructor(readonly handlers: TranslateSocketHandlers) {}

  connect(): Promise<void> {
    this.connectCalls += 1;
    return Promise.resolve();
  }

  /**
   * Mints ids the way the real socket does, from a counter rather than
   * `randomUUID` so a failing assertion names `t1` instead of a fresh UUID that
   * tells the reader nothing.
   */
  private nextTurn = 0;

  startSession(direction: TranslationDirection): string {
    const turnId = `t${++this.nextTurn}`;
    this.sent.push({ type: 'client.session.start', direction, turnId });
    return turnId;
  }

  sendAudio(sessionId: string, sequence: number, _sampleRate: number, payload: string): void {
    this.sent.push({ type: 'client.audio.frame', sessionId, sequence, payload });
  }

  speculate(sessionId: string | null): void {
    this.sent.push({ type: 'client.turn.speculate', sessionId: sessionId ?? undefined });
  }

  endSession(sessionId: string | null): void {
    this.sent.push({ type: 'client.session.end', sessionId: sessionId ?? undefined });
  }

  sendTurnMetrics(metrics: ClientTurnMetrics): void {
    this.sent.push({ type: 'client.turn.metrics', sessionId: metrics.sessionId, metrics });
  }

  close(): void {
    this.closed += 1;
  }

  /** Push a server event through, as the real socket does on a frame. */
  emit(event: ServerEvent): void {
    this.handlers.onEvent(event);
  }

  /** Report the transport dropping mid-conversation. */
  drop(): void {
    this.handlers.onClosed?.();
  }

  get audioFrames(): SentEvent[] {
    return this.sent.filter((e) => e.type === 'client.audio.frame');
  }
}

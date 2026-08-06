import { base64ToPcm16, pcm16ToBase64, TARGET_SAMPLE_RATE } from '../audio/pcm-resampler.js';
import type { LiveTranslateSocket } from '../transport/live-translate-socket.js';
import type { LiveTranslateSocketHandlers } from '../transport/live-translate-socket.js';
import type { LiveServerEvent, TranslationDirection } from '@chatofy/types';

/**
 * Drives one continuous speech-to-speech conversation.
 *
 * The one thing that separates this from `ConversationSession`, and the reason
 * it is a separate file rather than a mode of it:
 *
 *   THE GATE DOES NOT DECIDE WHAT IS SENT.
 *
 * On the turn path, `CapturePump` withholds silence — it holds quiet blocks back
 * so the server's speculation check stays valid, and it opens and closes turns.
 * Here the backend has no endpoint event at all: it learns an utterance ended
 * from trailing quiet. Withholding that quiet truncates the translation, which
 * was measured, not guessed — a 3 s clip cut at its last speech sample came back
 * as "However, the graft" and nothing more.
 *
 * So this class takes every block it is handed and sends it. A caller that wants
 * a level meter or a "speaking" indicator runs a gate alongside for the stamp;
 * it must never be allowed to gate this path's audio.
 */

/** What the caller must supply, so a test can drive this without a browser. */
export interface LiveSessionDeps {
  createSocket: (handlers: LiveTranslateSocketHandlers) => LiveTranslateSocket;
  /** Where translated audio goes. Called with 24 kHz mono PCM from the backend. */
  play: (samples: Int16Array, sampleRate: number) => void;
}

export interface LiveSessionListeners {
  /** Incremental text of what the backend heard, in the language it DETECTED. */
  onSourceText?: (delta: string, lang: string) => void;
  /** Incremental text of what the backend spoke. */
  onTargetText?: (delta: string) => void;
  onReady?: (sessionId: string) => void;
  onEnded?: (reason: string) => void;
  onError?: (message: string) => void;
}

export type LiveSessionStatus = 'idle' | 'connecting' | 'live' | 'stopped';

/**
 * Blocks held while the upstream is dialing, at ~20 ms each.
 *
 * 250 is about five seconds — comfortably longer than a dial, and short enough
 * that a session which never connects cannot hold meaningful memory. Past it the
 * oldest go first, because the newest audio is the part still being spoken.
 */
const MAX_PENDING_BLOCKS = 250;

export class LiveSession {
  private socket: LiveTranslateSocket | null = null;
  private sequence = 0;
  private status: LiveSessionStatus = 'idle';
  /** Audio captured before the upstream was ready. See {@link pushBlock}. */
  private pending: Int16Array[] = [];
  /**
   * One key for the whole conversation.
   *
   * `PcmPlaybackQueue` keys by turn so it can answer "is this turn still
   * sounding". There are no turns here — the backend produces one unbroken
   * stream — so everything shares a key and plays in arrival order, which is the
   * order the backend chose.
   */
  private readonly playbackKey = 'live';

  constructor(
    private readonly deps: LiveSessionDeps,
    private readonly listeners: LiveSessionListeners = {},
  ) {}

  get state(): LiveSessionStatus {
    return this.status;
  }

  async start(direction: TranslationDirection): Promise<void> {
    if (this.status === 'connecting' || this.status === 'live') return;
    this.status = 'connecting';
    this.sequence = 0;
    this.pending = [];

    const socket = this.deps.createSocket({
      onEvent: (event) => this.onEvent(event),
      onClosed: () => {
        if (this.status !== 'stopped') {
          this.status = 'stopped';
          this.listeners.onEnded?.('connection_closed');
        }
      },
      onError: (message) => this.listeners.onError?.(message),
    });
    this.socket = socket;

    try {
      await socket.connect();
    } catch (err) {
      this.status = 'idle';
      this.socket = null;
      this.listeners.onError?.(err instanceof Error ? err.message : 'Cannot reach the translator');
      return;
    }
    socket.start(direction);
  }

  /**
   * Take one block of captured audio.
   *
   * Never filtered on content — see the class comment. The caller must keep
   * calling this through pauses in speech; stopping at the last word is what
   * truncates the translation. Blocks that arrive before the upstream is ready
   * are held rather than discarded, so nothing spoken is ever thrown away.
   */
  pushBlock(block: Int16Array): void {
    if (this.status === 'stopped') return;
    // Held, not dropped. Capture starts the moment the caller wires the
    // microphone, but the upstream takes a moment to dial — and a user presses
    // Start and begins talking immediately. Discarding this window silently
    // truncated the FIRST utterance of every conversation and nothing after it,
    // which is exactly how it was noticed: "the first sentence always lags, the
    // rest are fine." The audio was captured; it belongs to the utterance.
    if (this.status !== 'live' || !this.socket) {
      this.pending.push(block);
      // Bounded so a session that never connects cannot grow this without end.
      // Oldest first: the tail is the part still being spoken.
      while (this.pending.length > MAX_PENDING_BLOCKS) this.pending.shift();
      return;
    }
    this.socket.sendAudio(this.sequence++, TARGET_SAMPLE_RATE, pcm16ToBase64(block));
  }

  /** Send everything captured while the upstream was still dialing. */
  private flushPending(): void {
    if (!this.socket) return;
    const held = this.pending;
    this.pending = [];
    for (const block of held) {
      this.socket.sendAudio(this.sequence++, TARGET_SAMPLE_RATE, pcm16ToBase64(block));
    }
  }

  stop(): void {
    if (!this.socket) {
      this.status = 'stopped';
      return;
    }
    this.status = 'stopped';
    this.socket.stop();
    // Closed on the server's `server.live.ended`, not here: closing now would
    // drop the last frames of translated audio still in flight.
  }

  /** Tear down without waiting for anything. For unmount, not for a normal end. */
  dispose(): void {
    this.status = 'stopped';
    this.pending = [];
    this.socket?.close();
    this.socket = null;
  }

  private onEvent(event: LiveServerEvent): void {
    switch (event.type) {
      case 'server.live.ready':
        this.status = 'live';
        // Before the callback: a listener that starts a timer on ready should
        // see the held audio already on the wire, not arriving after it.
        this.flushPending();
        this.listeners.onReady?.(event.sessionId);
        return;
      case 'server.live.transcript':
        if (event.channel === 'source') this.listeners.onSourceText?.(event.delta, event.lang);
        else this.listeners.onTargetText?.(event.delta);
        return;
      case 'server.live.audio': {
        // The rate travels with the frame because it is the backend's, not
        // ours: capture is 16 kHz and this answers at 24 kHz.
        const samples = base64ToPcm16(event.frame.payload);
        this.deps.play(samples, event.frame.sampleRate);
        return;
      }
      case 'server.live.ended':
        this.status = 'stopped';
        this.socket?.close();
        this.socket = null;
        this.listeners.onEnded?.(event.reason);
        return;
      case 'server.live.error':
        this.listeners.onError?.(`${event.code}: ${event.message}`);
        return;
    }
  }

  /** The key every chunk plays under. Exposed so a caller can drain by it. */
  get playbackTurnKey(): string {
    return this.playbackKey;
  }
}

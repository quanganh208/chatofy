import type {
  LanguageCode,
  RealtimeProvider,
  StreamHandle,
} from '@chatofy/ai-providers';
import type { TranslationDirection } from '@chatofy/types';
import type { LiveSessionMetrics } from '../services/live-session-metrics.recorder';
import { MAX_LIVE_SESSION_INPUT_BYTES } from './live-session-limits';

/**
 * One continuous conversation, and everything measured about it.
 *
 * The counters are private and moved only through the `note*` methods. They were
 * public fields mutated from the service — `session.sourceChars += delta.length`
 * and eight more like it — which put the rule for each number several hundred
 * lines from the number itself, and left the metrics row assembled by hand from
 * eleven fields that nothing checked were the right eleven.
 */
export class LiveSession {
  /**
   * Null while the upstream is still being dialed.
   *
   * Modelled honestly rather than asserted non-null, because the session is
   * registered BEFORE the dial completes — see `LiveTranslateSessionService.start`.
   * Pretending it is always present would make `pushFrame` and `finish` lie about
   * a session that genuinely has no socket yet.
   */
  private upstream: StreamHandle | null = null;
  private sequence = 0;
  private inputBytes = 0;
  private outputBytes = 0;
  /** Rate the last audio chunk arrived at, for turning bytes into milliseconds. */
  private outputRate = 0;
  private sourceChars = 0;
  private targetChars = 0;
  private languageMismatches = 0;
  private upstreamConnectMs = 0;
  private firstUpstreamByteMs?: number;
  /** Latched, so two close paths racing cannot write two rows for one session. */
  private closed = false;
  /** Last time a frame arrived, for the idle sweep. */
  private lastFrame: number;

  constructor(
    readonly sessionId: string,
    readonly direction: TranslationDirection,
    readonly source: LanguageCode,
    readonly startedAt: number,
    /**
     * Held on the session rather than looked up per frame.
     *
     * The provider routes by handle id, so any instance could serve the push —
     * but re-resolving on every 100 ms frame would build a client and its
     * connection pool at frame rate.
     */
    readonly provider: RealtimeProvider,
  ) {
    this.lastFrame = startedAt;
  }

  get handle(): StreamHandle | null {
    return this.upstream;
  }

  get finished(): boolean {
    return this.closed;
  }

  get lastFrameAt(): number {
    return this.lastFrame;
  }

  /** The upstream answered. Stamps how long the dial took. */
  attach(handle: StreamHandle, now: number): void {
    this.upstream = handle;
    this.upstreamConnectMs = now - this.startedAt;
    this.lastFrame = now;
  }

  noteSourceDelta(delta: string, lang: LanguageCode): void {
    this.sourceChars += delta.length;
    // Counted, not corrected. The docs warn auto-detection struggles with
    // similar languages and heavy accents, and a column that says how often it
    // was wrong is the only way that warning becomes a measurement instead of a
    // caveat.
    if (lang !== this.source) this.languageMismatches += 1;
  }

  noteTargetDelta(delta: string): void {
    this.targetChars += delta.length;
  }

  /** Translated audio came back. The first one also stamps time-to-first-byte. */
  noteTranslatedAudio(chunk: Uint8Array, rate: number, now: number): void {
    this.firstUpstreamByteMs ??= now - this.startedAt;
    this.outputBytes += chunk.length;
    this.outputRate = rate;
  }

  /** Frame counter for the outbound framer. Returns the value before the bump. */
  nextSequence(): number {
    return this.sequence++;
  }

  noteFrame(bytes: number, now: number): void {
    this.inputBytes += bytes;
    this.lastFrame = now;
  }

  /**
   * A quota ceiling, not a memory one — the bytes are forwarded, never held.
   *
   * It exists because nothing else bounds how long an unauthenticated socket can
   * keep a metered upstream session alive while it is actively speaking, which is
   * exactly the case the idle sweep cannot see.
   */
  hasExceededInputCeiling(): boolean {
    return this.inputBytes > MAX_LIVE_SESSION_INPUT_BYTES;
  }

  /**
   * Claim the right to close this session, once.
   *
   * Returns true to exactly one caller. The close paths race by design: a client
   * that sends `client.live.stop` and immediately drops its socket arrives twice,
   * and so does an upstream close landing while `stop` is awaiting. Read and set
   * together here so no caller can interleave between the two.
   */
  finishOnce(): boolean {
    if (this.closed) return false;
    this.closed = true;
    return true;
  }

  toMetricsRow(reason: string, now: number): LiveSessionMetrics {
    return {
      sessionId: this.sessionId,
      direction: this.direction,
      durationMs: now - this.startedAt,
      inputBytes: this.inputBytes,
      // Bytes → ms at the rate the backend actually used, 16-bit mono.
      outputAudioMs: this.outputRate
        ? Math.round((this.outputBytes / 2 / this.outputRate) * 1000)
        : 0,
      sourceChars: this.sourceChars,
      targetChars: this.targetChars,
      languageMismatches: this.languageMismatches,
      upstreamConnectMs: this.upstreamConnectMs,
      firstUpstreamByteMs: this.firstUpstreamByteMs,
      reason,
    };
  }
}

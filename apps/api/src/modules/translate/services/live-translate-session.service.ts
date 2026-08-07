import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ProviderRegistry,
  type LanguageCode,
  type RealtimeProvider,
  type StreamHandle,
} from '@chatofy/ai-providers';
import type {
  AudioFrame,
  LiveServerEvent,
  TranslationDirection,
} from '@chatofy/types';
import type { Env } from '../../../config/env.schema';
import { LiveSessionMetricsRecorder } from './live-session-metrics.recorder';
import { pushTranslatedPcm } from '../session/outbound-audio-framer';
import type { StreamSocket } from '../session/stream-socket';
// Only the global ceiling is imported. The per-socket one has nothing to
// enforce here: this path allows exactly one session per connection, which is
// already below it.
import {
  MAX_CONCURRENT_TURNS_GLOBAL,
  TURN_IDLE_SWEEP_MS,
  TURN_IDLE_TIMEOUT_MS,
} from '../session/turn-concurrency';
import { MAX_LIVE_SESSION_INPUT_BYTES } from '../session/live-session-limits';

/** Rate the backend takes. Anything else is refused rather than resampled here. */
const REQUIRED_INPUT_RATE = 16000;

/** Language pair for a direction, both of which the session needs. */
function languagesFor(direction: TranslationDirection): {
  source: LanguageCode;
  target: LanguageCode;
} {
  return direction === 'vi_to_en'
    ? { source: 'vi', target: 'en' }
    : { source: 'en', target: 'vi' };
}

/** One continuous conversation, and everything measured about it. */
interface LiveSession {
  readonly sessionId: string;
  readonly direction: TranslationDirection;
  readonly source: LanguageCode;
  readonly startedAt: number;
  /**
   * Held on the session rather than looked up per frame.
   *
   * The provider routes by handle id, so any instance could serve the push —
   * but re-resolving on every 100 ms frame would build a client and its
   * connection pool at frame rate.
   */
  provider: RealtimeProvider;
  /**
   * Null while the upstream is still being dialed.
   *
   * Modelled honestly rather than asserted non-null, because the session is now
   * registered BEFORE the dial completes — see `start()`. Pretending it is
   * always present would make `pushFrame` and `finish` lie about a session that
   * genuinely has no socket yet.
   */
  handle: StreamHandle | null;
  sequence: number;
  inputBytes: number;
  outputBytes: number;
  /** Rate the last audio chunk arrived at, for turning bytes into milliseconds. */
  outputRate: number;
  sourceChars: number;
  targetChars: number;
  languageMismatches: number;
  upstreamConnectMs: number;
  firstUpstreamByteMs?: number;
  /** Latched, so two close paths racing cannot write two rows for one session. */
  finished: boolean;
  /** Last time a frame arrived, for the idle sweep. */
  lastFrameAt: number;
}

/**
 * Per-connection state machine for the continuous mode of `/ws/translate`.
 *
 * Deliberately not a variant of {@link TranslationSessionService}. That one owns
 * turns: it buffers a whole utterance, waits for the client to declare an
 * endpoint, then runs STT → translate → TTS and streams clauses back. None of
 * those steps exist here. This backend has no endpoint event at all — it
 * translates while the speaker is still talking, and learns the utterance ended
 * from trailing quiet.
 *
 * That difference is why audio is forwarded unconditionally. Withholding silent
 * frames, which is exactly what the turn path's gate does, truncates the
 * translation: measured on a 3 s clip, cutting the stream at the last speech
 * sample returned "However, the graft" and nothing more.
 */
@Injectable()
export class LiveTranslateSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveTranslateSessionService.name);
  /**
   * One session per socket. A map rather than a field because the service is a
   * singleton shared by every connection, and the socket is the key the gateway
   * has.
   */
  private readonly sessions = new Map<StreamSocket, LiveSession>();

  private idleSweep: ReturnType<typeof setInterval> | null = null;
  /**
   * Where the next session starts its walk across the configured keys.
   *
   * The rotation lives here rather than in the provider because a live session
   * connects once and holds — there is no moment at which the provider could
   * rotate. It cannot live in a caller either: on this path the SERVER is what
   * opens sessions, so a measurement harness driving the continuous mode has no
   * way to choose. That is what `RealtimeStartParams.apiKey` is for, and this is
   * the only thing that reaches it.
   *
   * Gemini meters quota per project per model, so several keys only raise the
   * ceiling when they come from different Google Cloud projects — the same
   * caveat `GEMINI_API_KEY` already carries for the turn path.
   */
  private keyCursor = 0;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: ProviderRegistry,
    private readonly metrics: LiveSessionMetricsRecorder,
  ) {
    // The global ceiling needs this to mean anything, and the argument is
    // stronger here than on the turn path that already has one: a live session
    // holds a metered socket to Google, not a local buffer, so six connections
    // that start a session and then say nothing would deny the endpoint to
    // everyone indefinitely, at no cost to whoever is holding them. This path
    // takes no authentication.
    //
    // `unref` so housekeeping can never be the reason a process refuses to exit.
    this.idleSweep = setInterval(() => {
      void this.sweepIdleSessions();
    }, TURN_IDLE_SWEEP_MS);
    this.idleSweep.unref?.();
  }

  /**
   * Close sessions whose client has stopped sending audio.
   *
   * Public so a spec can drive it without waiting on an interval. A session that
   * is still dialing is exempt: it has sent no frame yet by definition, and
   * closing it would race the dial rather than reclaim anything.
   */
  async sweepIdleSessions(now = Date.now()): Promise<number> {
    const stale = [...this.sessions.entries()].filter(
      ([, session]) =>
        session.handle !== null &&
        now - session.lastFrameAt >= TURN_IDLE_TIMEOUT_MS,
    );
    for (const [socket, session] of stale) {
      this.logger.warn(
        `live ${session.sessionId} idle for ${Math.round((now - session.lastFrameAt) / 1000)}s; closing`,
      );
      this.fail(
        socket,
        'session_abandoned',
        'The session was closed after too long without audio',
        session.sessionId,
      );
      await this.finish(socket, 'idle_timeout');
    }
    return stale.length;
  }

  /** Open the upstream session and tell the client it may start speaking. */
  async start(
    socket: StreamSocket,
    direction: TranslationDirection,
  ): Promise<void> {
    if (this.sessions.has(socket)) {
      this.fail(
        socket,
        'session_exists',
        'This connection already has a live session',
      );
      return;
    }
    // One live session is one long-lived upstream socket, so it costs the
    // machine what a turn costs and is bounded by the same number.
    //
    // The same NUMBER, not the same counter: this counts live sessions only,
    // while the turn path counts turns only (`registry.countGlobal()` in
    // TranslationSessionService). So the two can reach `2 ×
    // MAX_CONCURRENT_TURNS_GLOBAL` between them. Worth stating plainly now that
    // both families share one path, because "shared ceiling" is the natural
    // reading and it is not what this does. Making it one counter is a capacity
    // change, deliberately not folded into the path merge.
    if (this.sessions.size >= MAX_CONCURRENT_TURNS_GLOBAL) {
      this.fail(
        socket,
        'too_many_sessions',
        'The translator is at capacity; try again shortly',
      );
      return;
    }

    const { source, target } = languagesFor(direction);
    const sessionId = randomUUID();
    const connectStartedAt = Date.now();

    let provider: RealtimeProvider;
    try {
      provider = this.registry.resolveOnly('realtime', {
        geminiApiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
      });
    } catch (err) {
      this.logger.error(`cannot resolve a realtime provider: ${message(err)}`);
      this.fail(
        socket,
        'provider_unavailable',
        'No speech-to-speech backend is configured',
      );
      return;
    }

    const session: LiveSession = {
      sessionId,
      direction,
      source,
      startedAt: connectStartedAt,
      provider,
      handle: null,
      sequence: 0,
      inputBytes: 0,
      outputBytes: 0,
      outputRate: 0,
      sourceChars: 0,
      targetChars: 0,
      languageMismatches: 0,
      upstreamConnectMs: 0,
      finished: false,
      lastFrameAt: connectStartedAt,
    };

    // Registered BEFORE the dial, not after. The WebSocket adapter does not
    // serialize handlers, so with the registration on the far side of this
    // await, N `client.live.start` messages sent back to back all passed both
    // guards above: measured, 50 concurrent starts against a ceiling of 6, and
    // every overwritten handle became an upstream socket no close path could
    // reach. Reserving the slot first is what makes the guards mean anything.
    this.sessions.set(socket, session);

    let handle: StreamHandle;
    try {
      handle = await provider.start(
        {
          sourceLanguage: source,
          targetLanguage: target,
          audioFormat: {
            encoding: 'pcm16',
            sampleRate: REQUIRED_INPUT_RATE,
            channels: 1,
          },
          apiKey: this.nextApiKey(),
        },
        {
          onSourceTranscript: (delta, lang) => {
            session.sourceChars += delta.length;
            // Counted, not corrected. The docs warn auto-detection struggles
            // with similar languages and heavy accents, and a column that says
            // how often it was wrong is the only way that warning becomes a
            // measurement instead of a caveat.
            if (lang !== session.source) session.languageMismatches += 1;
            this.emit(socket, {
              type: 'server.live.transcript',
              sessionId,
              channel: 'source',
              delta,
              lang,
            });
          },
          onTargetTranscript: (delta) => {
            session.targetChars += delta.length;
            this.emit(socket, {
              type: 'server.live.transcript',
              sessionId,
              channel: 'target',
              delta,
              lang: target,
            });
          },
          onTranslatedAudio: (chunk, rate) => {
            session.firstUpstreamByteMs ??= Date.now() - connectStartedAt;
            session.outputBytes += chunk.length;
            session.outputRate = rate;
            pushTranslatedPcm(
              (frame) =>
                this.emit(socket, { type: 'server.live.audio', frame }),
              sessionId,
              () => session.sequence++,
              Buffer.from(chunk),
              rate,
            );
          },
          onError: (err) => {
            this.logger.warn(`live ${sessionId}: ${err.message}`);
            this.emit(socket, {
              type: 'server.live.error',
              code: 'upstream_error',
              message: err.message,
              sessionId,
            });
          },
          // The upstream can end the conversation on its own — the ~30-minute
          // ephemeral-token window is the expected way. Reconnect is a stated
          // non-goal, so the whole requirement is that the client is told
          // cleanly rather than left with a socket that has gone quiet.
          onClose: (reason) => {
            void this.finish(socket, reason ?? 'upstream_closed');
          },
        },
      );
    } catch (err) {
      // A rejected key or exhausted quota arrives here, because the provider
      // turns an early upstream close into a thrown error rather than a handle
      // that only looks alive. Release the slot reserved above.
      this.sessions.delete(socket);
      this.logger.error(`live ${sessionId} failed to start: ${message(err)}`);
      this.fail(
        socket,
        'upstream_unavailable',
        'Could not open a translation session',
      );
      return;
    }

    // The session may have ended while this was dialing: the client can stop or
    // drop, and the upstream can hang up the moment it opens. `finish()` has
    // then already written the row and told the client, but it had no handle to
    // close — there was none yet. This is the only remaining chance to close it,
    // and without it the socket to Google stays open with nothing referencing
    // it. The provider solved the same shape of bug one level down.
    if (session.finished) {
      try {
        await handle.close();
      } catch (err) {
        this.logger.warn(
          `live ${sessionId} late close failed: ${message(err)}`,
        );
      }
      return;
    }

    session.handle = handle;
    session.upstreamConnectMs = Date.now() - connectStartedAt;
    session.lastFrameAt = Date.now();
    this.logger.log(`live.start ${sessionId} direction=${direction}`);
    this.emit(socket, { type: 'server.live.ready', sessionId });
  }

  /**
   * Forward one frame upstream.
   *
   * No silence gate, and that is the single most important line in this file.
   * The turn path withholds quiet frames because its endpointer decides when an
   * utterance is over; here the MODEL decides, and quiet is how it is told.
   */
  async pushFrame(socket: StreamSocket, frame: AudioFrame): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) {
      this.fail(socket, 'no_live_session', 'Send client.live.start first');
      return;
    }
    if (
      frame.encoding !== 'pcm16' ||
      frame.sampleRate !== REQUIRED_INPUT_RATE
    ) {
      // Refused rather than resampled. The client already captures at 16 kHz
      // mono, so anything else is a client bug, and quietly resampling it would
      // hide that while adding a stage to the very latency being measured.
      this.fail(
        socket,
        'unsupported_audio',
        `The live path takes ${REQUIRED_INPUT_RATE} Hz pcm16; got ${frame.sampleRate} Hz ${frame.encoding}`,
        session.sessionId,
      );
      return;
    }

    if (!session.handle) {
      // The upstream is still being dialed. A client that waits for
      // `server.live.ready`, as the contract says, never sees this.
      this.fail(
        socket,
        'session_starting',
        'The session is still opening; wait for server.live.ready',
        session.sessionId,
      );
      return;
    }

    const audio = Buffer.from(frame.payload, 'base64');
    session.inputBytes += audio.length;
    session.lastFrameAt = Date.now();

    // A quota ceiling, not a memory one — the bytes are forwarded, never held.
    // It exists because nothing else bounds how long an unauthenticated socket
    // can keep a metered upstream session alive while it is actively speaking,
    // which is exactly the case the idle sweep below cannot see.
    if (session.inputBytes > MAX_LIVE_SESSION_INPUT_BYTES) {
      this.fail(
        socket,
        'session_too_long',
        'The session reached its audio ceiling',
        session.sessionId,
      );
      await this.finish(socket, 'too_much_audio');
      return;
    }

    await session.provider.pushAudio(session.handle, new Uint8Array(audio));
  }

  /** End the session and write its row. Safe to call twice. */
  async stop(socket: StreamSocket, reason: string): Promise<void> {
    await this.finish(socket, reason);
  }

  /**
   * Close every session this process still holds.
   *
   * The provider's own map only shrinks when a handle is closed or the upstream
   * hangs up, so without this a shutdown leaves one socket open to Google per
   * live conversation, each holding quota until the remote times it out.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.idleSweep) clearInterval(this.idleSweep);
    this.idleSweep = null;
    await Promise.all(
      [...this.sessions.keys()].map((socket) =>
        this.finish(socket, 'server_shutdown'),
      ),
    );
  }

  /** Sessions currently open, for the ceiling checks and for specs. */
  get openCount(): number {
    return this.sessions.size;
  }

  /**
   * The key the next session opens with, walking the configured pool.
   *
   * Undefined when only one key is configured, so the provider falls back to its
   * own — one key rotated over is just that key, and passing it explicitly would
   * only add a way for the two to disagree.
   */
  private nextApiKey(): string | undefined {
    const keys = (this.config.get('GEMINI_API_KEY', { infer: true }) ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    if (keys.length <= 1) return undefined;
    const key = keys[this.keyCursor % keys.length];
    this.keyCursor += 1;
    return key;
  }

  private emit(socket: StreamSocket, event: LiveServerEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch (err) {
      // A socket that closed underneath us surfaces here. `ws` reports a send
      // after close as an error when no callback is given, and an unhandled one
      // would take the process down for a client that has already left.
      this.logger.warn(`dropped ${event.type}: ${message(err)}`);
    }
  }

  private fail(
    socket: StreamSocket,
    code: string,
    detail: string,
    sessionId?: string,
  ): void {
    this.emit(socket, {
      type: 'server.live.error',
      code,
      message: detail,
      sessionId,
    });
  }

  /**
   * Close the upstream, tell the client, write exactly one row.
   *
   * Latched on `finished` because the close paths race by design: a client that
   * sends `client.live.stop` and immediately drops its socket reaches here
   * twice, and so does an upstream close that arrives while `stop` is awaiting.
   */
  private async finish(socket: StreamSocket, reason: string): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session || session.finished) return;
    session.finished = true;
    this.sessions.delete(socket);

    // Null while the upstream is still being dialed. The latch above is what
    // makes that safe: `start()` sees `finished` when its await resolves and
    // closes the handle it was just handed, so the socket is not orphaned and
    // this stays the only row written for the session.
    try {
      await session.handle?.close();
    } catch (err) {
      this.logger.warn(
        `live ${session.sessionId} close failed: ${message(err)}`,
      );
    }

    this.metrics.record({
      sessionId: session.sessionId,
      direction: session.direction,
      durationMs: Date.now() - session.startedAt,
      inputBytes: session.inputBytes,
      // Bytes → ms at the rate the backend actually used, 16-bit mono.
      outputAudioMs: session.outputRate
        ? Math.round((session.outputBytes / 2 / session.outputRate) * 1000)
        : 0,
      sourceChars: session.sourceChars,
      targetChars: session.targetChars,
      languageMismatches: session.languageMismatches,
      upstreamConnectMs: session.upstreamConnectMs,
      firstUpstreamByteMs: session.firstUpstreamByteMs,
      reason,
    });

    this.emit(socket, {
      type: 'server.live.ended',
      sessionId: session.sessionId,
      reason,
    });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

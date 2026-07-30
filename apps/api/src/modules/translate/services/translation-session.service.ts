import {
  HttpException,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  type AudioFrame,
  type ClientTurnMetrics,
  type SessionOptions,
} from '@chatofy/types';
import {
  PipelineTranslatorService,
  type TranslatedTurnText,
} from './pipeline-translator.service';
import { TurnMetricsRecorder } from './turn-metrics.recorder';
import { splitIntoClauses } from '../audio/clause-splitter';
import { EventChannel, type TurnRef } from '../session/event-channel';
import { pushSynthesizedWav } from '../session/outbound-audio-framer';
import { TurnSession } from '../session/turn-session';
import { SessionRegistry } from '../session/session-registry';
import { TurnTimeline, type ClauseDelivery } from '../session/turn-timeline';
import type { StreamSocket } from '../session/stream-socket';
import { LivePreview } from '../session/live-preview';
import {
  FINAL_MODELS,
  SPECULATION_MODELS,
} from '../session/translation-model-policy';
import {
  MAX_CONCURRENT_TURNS_GLOBAL,
  MAX_CONCURRENT_TURNS_PER_SOCKET,
  MAX_REMEMBERED_METRICS_ROWS,
  TURN_IDLE_SWEEP_MS,
  TURN_IDLE_TIMEOUT_MS,
} from '../session/turn-concurrency';

// Re-exported because the gateway and both specs import it from here.
export type { StreamSocket } from '../session/stream-socket';

/**
 * Per-connection state machine for the WebSocket translation path.
 *
 * One connection carries up to {@link MAX_CONCURRENT_TURNS_PER_SOCKET} turns at
 * once, each named by its own `sessionId`: `client.session.start` opens one,
 * `client.audio.frame` feeds the turn its id names, `client.session.end` runs
 * STT → translate → TTS for that turn and streams the result back as transcript
 * plus raw audio frames.
 *
 * It used to carry exactly one. That was not a resource decision — it was what
 * let a speaker be cut off while their translation played, because capture had to
 * stop for the turn to be answered. Several turns in flight is what continuous
 * capture needs, and it is why every event on this path names its turn.
 *
 * Two things separate it from the REST path, both measured rather than assumed:
 *
 *  - Synthesis runs clause by clause, so audio starts playing at the first
 *    comma instead of the final full stop (see `clause-splitter`).
 *  - `client.turn.speculate` lets transcription and translation start on a
 *    suspected end of speech, so a confirmed endpoint finds them already done.
 */
@Injectable()
export class TranslationSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(TranslationSessionService.name);
  private readonly registry = new SessionRegistry();
  private readonly preview: LivePreview;
  private idleSweep: ReturnType<typeof setInterval> | null = null;
  private readonly metricsFiled = new Set<string>();

  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly metrics: TurnMetricsRecorder,
  ) {
    // Built in the constructor body, not as a field initializer. Under
    // `target: ES2022` field initializers run before the parameter properties
    // are assigned, so `this.pipeline` would still be undefined up there.
    this.preview = new LivePreview(this.pipeline, this.logger);

    // `unref` so this interval cannot be the reason a process refuses to exit — it is
    // housekeeping, not work anyone is waiting for.
    this.idleSweep = setInterval(
      () => this.sweepIdleTurns(),
      TURN_IDLE_SWEEP_MS,
    );
    this.idleSweep.unref?.();
  }

  /** Open a turn and tell the client the id its frames must carry. */
  start(socket: StreamSocket, options: SessionOptions, turnId?: string): void {
    // The `session_busy` guard that used to stand here is gone, and only that
    // one. It refused a start while the socket's turn was mid-translation,
    // because a second turn would overwrite the first in a one-entry map and the
    // in-flight `end()` would then finish by deleting a turn the client had just
    // been handed. Keyed by session id, that collision cannot happen — there is
    // nothing left for the guard to protect.
    //
    // The two other emitters of `session_busy` are unrelated and stay: the one in
    // `end()` stops a turn being translated twice, and the one in
    // `TurnSession.acceptFrame` stops a frame landing in a buffer that `end()` is
    // already reading.
    //
    // Both ceilings are checked here, and each answers a question the other
    // cannot. Refused before any turn exists, so the only name these failures can
    // carry is the one the client supplied.
    if (this.registry.count(socket) >= MAX_CONCURRENT_TURNS_PER_SOCKET) {
      this.channelFor(socket, { turnId }).fail(
        'too_many_turns',
        `A connection may hold ${MAX_CONCURRENT_TURNS_PER_SOCKET} turns at once`,
      );
      return;
    }
    if (this.registry.countGlobal() >= MAX_CONCURRENT_TURNS_GLOBAL) {
      this.channelFor(socket, { turnId }).fail(
        'too_many_turns',
        'The translator is at capacity; try again in a moment',
      );
      return;
    }

    const session = new TurnSession(options, turnId);
    this.registry.open(socket, session);
    const sessionId = session.sessionId;
    this.logger.log(
      `session.start ${sessionId} direction=${options.direction} voice=${options.voiceGender}`,
    );
    this.channelFor(socket, session).emit({
      type: 'server.session.ready',
      sessionId,
      turnId: session.turnId,
    });
  }

  /** Append one inbound audio frame to the turn its own id names. */
  pushFrame(socket: StreamSocket, frame: AudioFrame): void {
    // Routed by the frame's own id, which the contract has always carried.
    const session = this.registry.get(socket, frame.sessionId);
    if (!session) {
      // Two different faults, and telling them apart matters to a client that
      // may hold several turns. With nothing open the client has not started a
      // turn at all. With other turns open it named one this socket does not
      // have — closed, or never opened — and answering "send start first" there
      // would be false, since it already did.
      if (this.registry.count(socket) === 0) {
        this.channelFor(socket).fail(
          'no_active_session',
          'Send client.session.start first',
        );
      } else {
        this.channelFor(socket).fail(
          'frame_rejected',
          'Frame belongs to another session',
        );
      }
      return;
    }
    // `acceptFrame` compares the id again, which now looks redundant: the lookup
    // above already found the turn by it. It is kept as a second layer and must
    // not be tidied away — it is the guard that has a test proving two turns'
    // audio cannot mix, and it is what makes `TurnSession` safe to hand a frame
    // without knowing how the caller found it.
    const rejection = session.acceptFrame(frame);
    if (rejection) {
      this.channelFor(socket, session).fail(rejection.code, rejection.message);
      // Only the length cap ends the turn, and reporting it is not enough: the
      // turn has to leave the registry or it keeps its buffer and stays usable.
      if (rejection.closesTurn) {
        // `turn_too_long` was another path that wrote no metrics row despite the
        // live preview having already spent requests on the turn.
        this.metrics.record(
          new TurnTimeline().toMetrics(
            session,
            session.buffered,
            false,
            rejection.code,
          ),
        );
        this.close(socket, session, rejection.code);
      }
      return;
    }

    this.preview.onAudio(session, this.channelFor(socket, session), () =>
      this.registry.holds(socket, session),
    );
  }

  /**
   * Start transcribing and translating what has been buffered so far, on the
   * client's suspicion that the speaker has stopped.
   *
   * Each pause replaces the previous guess rather than being ignored. The
   * client is not told anything: if a guess still matches at the endpoint,
   * `end()` silently arrives at an answer that is already computed.
   *
   * This used to allow one guess per turn, on the reasoning that a second would
   * double the cost. Measured, that reasoning was backwards. A guess is only
   * usable while no further audio follows it, so on a turn where the speaker
   * pauses and carries on, the single guess is spent on the first pause and can
   * never be redeemed — the turn pays for it AND for a full translation at the
   * end. Renewing costs the same two requests on such a turn and actually
   * arrives with an answer: 870ms to first audio instead of 1760ms. Only turns
   * that pause three times or more cost more than they used to, and
   * `MAX_SPECULATIONS_PER_TURN` in `session/translation-model-policy.ts` bounds
   * how much more.
   */
  speculate(socket: StreamSocket, sessionId?: string): void {
    const session = this.resolve(socket, sessionId);
    const audio = session?.buffered;
    if (!session || !audio || !session.canSpeculate()) return;

    session.startSpeculation(
      audio.byteLength,
      this.pipeline.transcribeAndTranslate({
        audio: audio.toWav(),
        mimeType: 'audio/wav',
        direction: session.direction,
        models: SPECULATION_MODELS,
      }),
    );
  }

  /** Close the turn: transcribe, translate, synthesize, stream the result. */
  async end(socket: StreamSocket, sessionId?: string): Promise<void> {
    const session = this.resolve(socket, sessionId);
    if (!session) {
      this.channelFor(socket).fail('no_active_session', 'No turn is open');
      return;
    }
    if (!session.isListening) {
      this.channelFor(socket, session).fail(
        'session_busy',
        'The turn is already being translated',
      );
      return;
    }
    const audio = session.buffered;
    if (!audio || audio.isEmpty) {
      // Recorded, where it used to be skipped. `LivePreview` may already have
      // spent transcription and translation requests on this turn, so a turn that
      // ends with no audio is not a free turn — leaving it out made
      // requests-per-minute computed from the log read lower than reality, and
      // continuous capture produces more of these than any other mode.
      this.metrics.record(
        new TurnTimeline().toMetrics(session, audio, false, 'no_audio'),
      );
      this.channelFor(socket, session).fail(
        'no_audio',
        'The turn carried no audio',
      );
      this.close(socket, session, 'no_audio');
      return;
    }

    session.beginTranslating();
    const timeline = new TurnTimeline();
    const record = (completed: boolean, reason?: string) =>
      this.metrics.record(
        timeline.toMetrics(session, audio, completed, reason),
      );

    try {
      const reusable = session.usableSpeculation();
      timeline.markSpeculationReused(reusable !== null);
      const translated = reusable
        ? await reusable
        : await this.pipeline.transcribeAndTranslate({
            audio: audio.toWav(),
            mimeType: 'audio/wav',
            direction: session.direction,
            models: FINAL_MODELS,
          });
      timeline.markTranslated(translated.targetText);

      // The client may have gone while the pipeline was working; finishing the
      // turn for nobody costs real quota and writes to a closed socket.
      //
      // Recorded as abandoned rather than not recorded at all. The old comment
      // here was right that a `finally` would file these as fast successes, and
      // wrong that the answer was silence: the quota was spent either way, so a
      // row that says `abandoned` is the only version of this file that can
      // account for it. It is marked incomplete, so a latency table that filters
      // on `completed` is unaffected.
      if (!this.registry.holds(socket, session)) {
        record(false, 'abandoned');
        return;
      }

      this.channelFor(socket, session).emit({
        type: 'server.transcript.final',
        sessionId: session.sessionId,
        segment: session.toSegment(
          translated.sourceText,
          translated.targetText,
        ),
      });

      const clauses = splitIntoClauses(translated.targetText);
      timeline.markClauses(clauses.length);
      const delivery = await this.streamClauses(
        socket,
        session,
        clauses,
        translated.targetLanguage,
      );
      timeline.markAudio(delivery);

      // A client that leaves part-way through delivery is the same case as one
      // that left before it, and is now answered the same way: recorded as
      // abandoned and incomplete, so the quota it spent is accounted for without
      // its truncated timings polluting a table of turns that finished.
      if (delivery.stoppedBy === 'client_gone') {
        record(false, 'abandoned');
        return;
      }

      // A turn the listener never heard through is not a completed turn, and
      // both the metrics row and the closing reason have to say so — the client
      // has just been sent an error explaining why the audio stopped.
      record(delivery.stoppedBy === undefined, delivery.stoppedBy);
      this.close(socket, session, delivery.stoppedBy ?? 'completed');
    } catch (err) {
      // Recorded on the way out too, so a latency table cannot mistake an
      // unwritten failure for the absence of failures. First statement in the
      // handler: if reporting the failure threw, the row would otherwise be lost.
      record(false, 'error');
      this.reportTurnFailure(socket, session, err);
      this.close(socket, session, 'error');
    }
  }

  /**
   * Close turns whose client has stopped saying anything.
   *
   * Public so a spec can drive it without waiting on an interval. Only turns still
   * LISTENING are considered: one that is translating is doing work with a measured
   * tail of up to ~9s and closes itself, and cutting that off would throw away an
   * answer someone is waiting for.
   *
   * This exists because of the global ceiling. A stuck turn used to cost only the
   * socket that owned it; sharing a process-wide limit turns the same stuck turn into a
   * denial of service for every other client, and `/ws/translate` takes no
   * authentication.
   */
  sweepIdleTurns(now = Date.now()): number {
    let closed = 0;
    for (const { socket, session } of this.registry.entries()) {
      if (!session.isListening) continue;
      if (session.idleMs(now) < TURN_IDLE_TIMEOUT_MS) continue;

      this.logger.warn(
        `turn ${session.sessionId} idle for ${Math.round(session.idleMs(now) / 1000)}s; closing`,
      );
      // Recorded like every other termination path: the live preview may already have
      // spent requests on this turn.
      this.metrics.record(
        new TurnTimeline().toMetrics(
          session,
          session.buffered,
          false,
          'idle_timeout',
        ),
      );
      this.channelFor(socket, session).fail(
        'turn_abandoned',
        'The turn was closed after too long without audio',
      );
      this.close(socket, session, 'idle_timeout');
      closed += 1;
    }
    return closed;
  }

  onModuleDestroy(): void {
    if (this.idleSweep) clearInterval(this.idleSweep);
    this.idleSweep = null;
  }

  /**
   * File the client's own measurements for one of its turns.
   *
   * Two headline numbers — capture coverage and how far the translation drifts
   * behind the speaker — exist only on the client. This server cannot know when
   * someone began speaking, and it cannot know when a loudspeaker produced sound.
   *
   * The ownership check is the whole security of this path. A turn id is not a
   * capability and `/ws/translate` takes no authentication, so without it any
   * client could file rows against another client's turn by naming it. A refused
   * event is dropped in silence: telling a caller which ids exist would turn this
   * into an oracle for guessing them.
   */
  recordClientMetrics(socket: StreamSocket, metrics: ClientTurnMetrics): void {
    if (!this.registry.owns(socket, metrics.sessionId)) {
      this.logger.warn('rejected client metrics for an unowned turn');
      return;
    }
    // One row per turn, because that is all a client ever has to say about one. Without
    // this, a socket that legitimately owns a session id can file the same row without
    // limit, and each one costs a log line and a queued append — enough for a single
    // connection to drive disk and log growth at line rate on an endpoint that takes no
    // authentication.
    if (this.metricsFiled.has(metrics.sessionId)) return;
    this.rememberMetricsFiled(metrics.sessionId);

    this.metrics.recordClient(metrics);
  }

  /**
   * Session ids that have already filed a client row.
   *
   * Bounded and evicted oldest-first. A turn whose id has aged out could file a second
   * row, which is a far smaller problem than an unbounded set: `owns()` has already
   * established the socket's claim, and the id has to still be in that socket's recent
   * history for the check above to pass at all.
   */
  private rememberMetricsFiled(sessionId: string): void {
    this.metricsFiled.add(sessionId);
    while (this.metricsFiled.size > MAX_REMEMBERED_METRICS_ROWS) {
      const oldest = this.metricsFiled.values().next().value;
      if (oldest === undefined) break;
      this.metricsFiled.delete(oldest);
    }
  }

  /** Drop state for a socket that went away without ending its turns. */
  disconnect(socket: StreamSocket): void {
    // Every turn, not just one: a socket that drops mid-conversation may have
    // several open, and any left behind would keep its audio buffer alive with
    // nothing able to reach it again.
    const sessions = this.registry.closeAll(socket);
    if (sessions.length === 0) return;
    this.logger.log(
      `session.disconnect ${sessions.map((s) => s.sessionId).join(' ')}`,
    );
  }

  /**
   * The turn a client event is about.
   *
   * A missing id means an older client — the contract keeps those fields optional
   * so a tab loaded before they existed keeps working — and the fallback is the
   * socket's turn when it has exactly one. It deliberately does not guess when
   * several are open: routing audio into the wrong utterance corrupts it without
   * reporting anything, and any client that opens concurrent turns sends the id.
   */
  private resolve(
    socket: StreamSocket,
    sessionId?: string,
  ): TurnSession | undefined {
    return sessionId === undefined
      ? this.registry.only(socket)
      : this.registry.get(socket, sessionId);
  }

  /**
   * Synthesize each clause in turn, pushing its audio before starting the next.
   *
   * Sequential on purpose: measured on this machine, a clause's audio always
   * outlasts the time needed to synthesize the one after it, so the client
   * plays continuously while the server is still working. Synthesizing them all
   * up front would only delay the first sound.
   */
  private async streamClauses(
    socket: StreamSocket,
    session: TurnSession,
    clauses: string[],
    language: TranslatedTurnText['targetLanguage'],
  ): Promise<ClauseDelivery> {
    let firstAudioAt: number | undefined;
    let lastAudioAt: number | undefined;

    for (const clause of clauses) {
      // Checked every iteration: a client that left mid-turn must not keep the
      // CPU synthesizing clauses nobody will hear.
      if (!this.registry.holds(socket, session)) {
        return { firstAudioAt, lastAudioAt, stoppedBy: 'client_gone' };
      }

      const speech = await this.pipeline.synthesize({
        text: clause,
        language,
        voiceGender: session.voiceGender,
      });
      const pushed = pushSynthesizedWav(
        this.channelFor(socket, session),
        session,
        Buffer.from(speech.bytes),
      );
      if (!pushed.ok) {
        // Reported once, then the turn's audio stops — the transcript already
        // went out, and every later clause would fail the same way.
        this.logger.error(
          `cannot frame ${speech.mimeType} output: ${pushed.detail}`,
        );
        this.channelFor(socket, session).fail(
          'unsupported_audio',
          `The configured TTS backend returns ${speech.mimeType}; the streaming path needs 16-bit PCM WAV`,
        );
        return { firstAudioAt, lastAudioAt, stoppedBy: 'unsupported_audio' };
      }
      firstAudioAt ??= Date.now();
      lastAudioAt = Date.now();
    }

    return { firstAudioAt, lastAudioAt };
  }

  /**
   * Report a failed turn. The pipeline already maps provider faults onto HTTP
   * exceptions for the REST path, so their messages are reused rather than
   * re-derived — a client should not get a different explanation of the same
   * fault depending on which transport it used.
   */
  private reportTurnFailure(
    socket: StreamSocket,
    session: TurnSession,
    err: unknown,
  ): void {
    const message =
      err instanceof HttpException ? err.message : 'Translation failed';
    this.logger.error(
      `turn ${session.sessionId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    this.channelFor(socket, session).fail('turn_failed', message);
  }

  /**
   * Drop the turn, then say so.
   *
   * The order is the point: while the socket is still in the registry the turn
   * holds its buffer and `end()` will happily run the whole pipeline on it, so
   * a client told "ended" before the eviction can carry on using a turn the
   * server has already reported closed.
   */
  private close(
    socket: StreamSocket,
    session: TurnSession,
    reason: string,
  ): void {
    // This turn only. Closing the socket's other turns here would end
    // conversations the client is still in the middle of.
    this.registry.close(socket, session.sessionId);
    // Bound to the session on purpose, and taken as an argument rather than
    // re-read from the registry: the eviction above has to happen first, so by
    // this point the registry can no longer name the turn that just ended.
    this.channelFor(socket, session).ended(reason);
  }

  /**
   * A channel for this socket, naming the turn its events belong to.
   *
   * `turn` is omitted only for faults that belong to the connection rather than
   * to any turn — "send client.session.start first" is the whole set.
   */
  private channelFor(socket: StreamSocket, turn?: TurnRef): EventChannel {
    return new EventChannel(socket, this.logger, turn ?? null);
  }
}

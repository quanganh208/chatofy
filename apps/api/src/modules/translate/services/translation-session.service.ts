import { HttpException, Injectable, Logger } from '@nestjs/common';
import { type AudioFrame, type TranslationDirection } from '@chatofy/types';
import {
  PipelineTranslatorService,
  type TranslatedTurnText,
} from './pipeline-translator.service';
import { TurnMetricsRecorder } from './turn-metrics.recorder';
import { splitIntoClauses } from '../audio/clause-splitter';
import { EventChannel } from '../session/event-channel';
import { pushSynthesizedWav } from '../session/outbound-audio-framer';
import { TurnSession } from '../session/turn-session';
import { SessionRegistry } from '../session/session-registry';
import { TurnTimeline } from '../session/turn-timeline';
import type { StreamSocket } from '../session/stream-socket';
import { LivePreview } from '../session/live-preview';
import {
  FINAL_MODELS,
  SPECULATION_MODELS,
} from '../session/translation-model-policy';

// Re-exported because the gateway and both specs import it from here.
export type { StreamSocket } from '../session/stream-socket';

/**
 * Per-connection state machine for the WebSocket translation path.
 *
 * One connection carries one turn: `client.session.start` opens it,
 * `client.audio.frame` feeds it, `client.session.end` runs
 * STT → translate → TTS and streams the result back as transcript plus raw
 * audio frames.
 *
 * Two things separate it from the REST path, both measured rather than assumed:
 *
 *  - Synthesis runs clause by clause, so audio starts playing at the first
 *    comma instead of the final full stop (see `clause-splitter`).
 *  - `client.turn.speculate` lets transcription and translation start on a
 *    suspected end of speech, so a confirmed endpoint finds them already done.
 */
@Injectable()
export class TranslationSessionService {
  private readonly logger = new Logger(TranslationSessionService.name);
  private readonly registry = new SessionRegistry();
  private readonly preview: LivePreview;

  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly metrics: TurnMetricsRecorder,
  ) {
    // Built in the constructor body, not as a field initializer. Under
    // `target: ES2022` field initializers run before the parameter properties
    // are assigned, so `this.pipeline` would still be undefined up there.
    this.preview = new LivePreview(this.pipeline, this.logger);
  }

  /** Open a turn and tell the client the id its frames must carry. */
  start(socket: StreamSocket, direction: TranslationDirection): void {
    // Replacing a turn that is mid-translation would leave the in-flight `end()`
    // holding the old session and finishing by deleting the new one, so the
    // client would end up with an id the server has forgotten.
    const existing = this.registry.get(socket);
    if (existing?.isTranslating) {
      this.channelFor(socket).fail(
        'session_busy',
        'The previous turn is still being translated',
      );
      return;
    }

    const session = new TurnSession(direction);
    this.registry.open(socket, session);
    const sessionId = session.sessionId;
    this.logger.log(`session.start ${sessionId} direction=${direction}`);
    this.channelFor(socket).emit({ type: 'server.session.ready', sessionId });
  }

  /** Append one inbound audio frame to the open turn. */
  pushFrame(socket: StreamSocket, frame: AudioFrame): void {
    const session = this.registry.get(socket);
    if (!session) {
      this.channelFor(socket).fail(
        'no_active_session',
        'Send client.session.start first',
      );
      return;
    }
    const rejection = session.acceptFrame(frame);
    if (rejection) {
      this.channelFor(socket).fail(rejection.code, rejection.message);
      // Only the length cap ends the turn, and reporting it is not enough: the
      // turn has to leave the registry or it keeps its buffer and stays usable.
      if (rejection.closesTurn) this.close(socket, rejection.code);
      return;
    }

    this.preview.onAudio(session, this.channelFor(socket), () =>
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
  speculate(socket: StreamSocket): void {
    const session = this.registry.get(socket);
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
  async end(socket: StreamSocket): Promise<void> {
    const session = this.registry.get(socket);
    if (!session) {
      this.channelFor(socket).fail('no_active_session', 'No turn is open');
      return;
    }
    if (!session.isListening) {
      this.channelFor(socket).fail(
        'session_busy',
        'The turn is already being translated',
      );
      return;
    }
    const audio = session.buffered;
    if (!audio || audio.isEmpty) {
      this.channelFor(socket).fail('no_audio', 'The turn carried no audio');
      this.close(socket, 'no_audio');
      return;
    }

    session.beginTranslating();
    const timeline = new TurnTimeline();
    const record = (completed: boolean) =>
      this.metrics.record(timeline.toMetrics(session, audio, completed));

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
      // This path deliberately records nothing. An abandoned turn is not a fast
      // turn, and a `finally` here would file every one of them as a success
      // that delivered its audio instantly.
      if (!this.registry.holds(socket, session)) return;

      this.channelFor(socket).emit({
        type: 'server.transcript.final',
        segment: session.toSegment(
          translated.sourceText,
          translated.targetText,
        ),
      });

      const clauses = splitIntoClauses(translated.targetText);
      timeline.markClauses(clauses.length);
      timeline.markAudio(
        await this.streamClauses(
          socket,
          session,
          clauses,
          translated.targetLanguage,
        ),
      );

      record(true);
      this.close(socket, 'completed');
    } catch (err) {
      // Recorded on the way out too, so a latency table cannot mistake an
      // unwritten failure for the absence of failures. First statement in the
      // handler: if reporting the failure threw, the row would otherwise be lost.
      record(false);
      this.reportTurnFailure(socket, session, err);
      this.close(socket, 'error');
    }
  }

  /** Drop state for a socket that went away without ending its turn. */
  disconnect(socket: StreamSocket): void {
    const session = this.registry.close(socket);
    if (!session) return;
    this.logger.log(`session.disconnect ${session.sessionId}`);
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
  ): Promise<{ firstAudioAt?: number; lastAudioAt?: number }> {
    let firstAudioAt: number | undefined;
    let lastAudioAt: number | undefined;

    for (const clause of clauses) {
      // Checked every iteration: a client that left mid-turn must not keep the
      // CPU synthesizing clauses nobody will hear.
      if (!this.registry.holds(socket, session)) break;

      const speech = await this.pipeline.synthesize({ text: clause, language });
      const pushed = pushSynthesizedWav(
        this.channelFor(socket),
        session,
        Buffer.from(speech.bytes),
      );
      if (!pushed.ok) {
        // Reported once, then the turn's audio stops — the transcript already
        // went out, and every later clause would fail the same way.
        this.logger.error(
          `cannot frame ${speech.mimeType} output: ${pushed.detail}`,
        );
        this.channelFor(socket).fail(
          'unsupported_audio',
          `The configured TTS backend returns ${speech.mimeType}; the streaming path needs 16-bit PCM WAV`,
        );
        break;
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
    this.channelFor(socket).fail('turn_failed', message);
  }

  /**
   * Drop the turn, then say so.
   *
   * The order is the point: while the socket is still in the registry the turn
   * holds its buffer and `end()` will happily run the whole pipeline on it, so
   * a client told "ended" before the eviction can carry on using a turn the
   * server has already reported closed.
   */
  private close(socket: StreamSocket, reason: string): void {
    this.registry.close(socket);
    this.channelFor(socket).ended(reason);
  }

  private channelFor(socket: StreamSocket): EventChannel {
    return new EventChannel(socket, this.logger);
  }
}

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  MAX_SAMPLE_RATE,
  type AudioFrame,
  type ServerEvent,
  type TranscriptSegment,
  type TranslationDirection,
} from '@chatofy/types';
import {
  PipelineTranslatorService,
  type TranslatedTurnText,
} from './pipeline-translator.service';
import { TurnMetricsRecorder } from './turn-metrics.recorder';
import { splitIntoClauses } from '../audio/clause-splitter';
import { PartialTranscriptScheduler } from '../audio/partial-transcript-scheduler';
import { LiveTranslationTrigger } from '../audio/live-translation-trigger';
import {
  decodeWavToPcm16,
  encodePcm16Wav,
  WavFormatError,
} from '../audio/wav-codec';

/**
 * The subset of a `ws` WebSocket this service drives.
 *
 * Kept structural rather than importing `ws`: the state machine only ever
 * pushes serialized events, so a test can supply a two-line fake instead of
 * standing up a socket.
 */
export interface StreamSocket {
  send(data: string): void;
}

/** Where a connection is in the turn it is currently taking. */
type TurnPhase = 'listening' | 'translating';

/**
 * Transcription and translation started on a suspected end of speech, before
 * the endpoint was confirmed.
 */
interface Speculation {
  /** Bytes buffered when it started; if the turn grew, the work is stale. */
  atBytes: number;
  work: Promise<TranslatedTurnText>;
  startedAt: number;
}

interface StreamSession {
  sessionId: string;
  direction: TranslationDirection;
  phase: TurnPhase;
  /** Inbound PCM16 for the turn, concatenated only once the turn ends. */
  chunks: Buffer[];
  bufferedBytes: number;
  /** Taken from the first frame; later frames must agree. */
  sampleRate: number | null;
  /** Last accepted inbound sequence, to catch replays and reordering. */
  lastSequence: number;
  outboundSequence: number;
  /** The most recent guess; earlier ones are superseded and dropped. */
  speculation: Speculation | null;
  /** How many guesses this turn has spent, against the cap. */
  speculations: number;
  /** Paces the live transcript for this turn. */
  partials: PartialTranscriptScheduler;
  /** Decides when this turn is worth translating before it ends. */
  liveTranslation: LiveTranslationTrigger;
}

/**
 * Guesses one turn may spend.
 *
 * Each is a translation request against a per-model per-minute ceiling, so this
 * is a spend limit, not a correctness one. Four covers a sentence with three
 * internal pauses, which is already a long conversational turn; past that the
 * turn keeps working and simply stops guessing, falling back to translating
 * once at the end.
 */
const MAX_SPECULATIONS_PER_TURN = 4;

/**
 * Translation models a live turn may use, fastest first.
 *
 * Deliberately shorter than the provider's own ladder, which ends in a model
 * measured at 6.9s and observed here at 10s and 18s. That model is a reasonable
 * last resort for `POST /translate`, where a slow answer still beats none. In a
 * conversation it is not an answer at all — the speaker has moved on. A live
 * turn would rather fail and say so.
 *
 * Guesses and final translations are given different ladders on purpose. Both
 * models are measured at the same speed, so leading with either costs nothing,
 * and the free tier meters per minute PER MODEL: keeping speculative traffic
 * off the model the endpoint depends on stops a talkative turn from spending
 * the quota its own ending needs. Measured before this split: speculation
 * pushed the shared ladder past its ceiling and two turns fell through to the
 * slow model.
 */
const FINAL_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const SPECULATION_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

/**
 * Model for translating a sentence that is still being spoken.
 *
 * One model and no fallback: a provisional translation is the most disposable
 * request this system makes, so a rate limit should cost the guess and nothing
 * else, rather than walk a ladder into the quota the speaker's actual answer
 * needs.
 *
 * Which model is the interesting part, and it follows from where the load
 * actually landed. Guesses lead with the other one, and because three turns in
 * four now reuse a guess, the endpoint itself rarely calls at all — so this
 * model is the idle one. Sending provisional work to the busy model instead was
 * measured: it clustered with the guesses inside the same turn, drew seven rate
 * limits over thirty-two turns, and one request came back after fifteen
 * seconds. The totals barely moved; the bunching was what hurt.
 */
const LIVE_TRANSLATION_MODELS = ['gemini-3.5-flash-lite'];

/** Inbound audio is mono; the contract carries no channel count. */
const INBOUND_CHANNELS = 1;

/**
 * Longest utterance a single turn will buffer. A conversational turn is a
 * sentence or two; anything past this is a stuck client, and the buffer is held
 * in memory until the turn ends.
 */
const MAX_TURN_SECONDS = 60;

/**
 * Hard byte ceiling for one turn's buffer.
 *
 * Derived from the contract's highest permitted rate rather than from the rate
 * the client reported: the socket is unauthenticated, and a cap scaled by a
 * client-supplied number is not a cap.
 */
const MAX_TURN_BYTES =
  MAX_SAMPLE_RATE * INBOUND_CHANNELS * 2 * MAX_TURN_SECONDS;

/**
 * Outbound audio chunk length. Short enough that playback can start well before
 * synthesis has been fully delivered, long enough that a turn does not become
 * hundreds of JSON frames.
 */
const OUTBOUND_FRAME_MS = 200;

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
  private readonly sessions = new Map<StreamSocket, StreamSession>();

  constructor(
    private readonly pipeline: PipelineTranslatorService,
    private readonly metrics: TurnMetricsRecorder,
  ) {}

  /** Open a turn and tell the client the id its frames must carry. */
  start(socket: StreamSocket, direction: TranslationDirection): void {
    // Replacing a turn that is mid-translation would leave the in-flight `end()`
    // holding the old session and finishing by deleting the new one, so the
    // client would end up with an id the server has forgotten.
    const existing = this.sessions.get(socket);
    if (existing?.phase === 'translating') {
      this.fail(
        socket,
        'session_busy',
        'The previous turn is still being translated',
      );
      return;
    }

    const sessionId = randomUUID();
    this.sessions.set(socket, {
      sessionId,
      direction,
      phase: 'listening',
      chunks: [],
      bufferedBytes: 0,
      sampleRate: null,
      lastSequence: -1,
      outboundSequence: 0,
      speculation: null,
      speculations: 0,
      partials: new PartialTranscriptScheduler(),
      liveTranslation: new LiveTranslationTrigger(),
    });
    this.logger.log(`session.start ${sessionId} direction=${direction}`);
    this.emit(socket, { type: 'server.session.ready', sessionId });
  }

  /** Append one inbound audio frame to the open turn. */
  pushFrame(socket: StreamSocket, frame: AudioFrame): void {
    const session = this.sessions.get(socket);
    if (!session) {
      this.fail(socket, 'no_active_session', 'Send client.session.start first');
      return;
    }
    if (session.phase !== 'listening') {
      this.fail(socket, 'session_busy', 'The turn is already being translated');
      return;
    }
    if (frame.sessionId !== session.sessionId) {
      this.fail(socket, 'frame_rejected', 'Frame belongs to another session');
      return;
    }
    if (frame.encoding !== 'pcm16') {
      this.fail(
        socket,
        'unsupported_audio',
        `Unsupported frame encoding ${frame.encoding}; this path expects pcm16`,
      );
      return;
    }
    // Gaps are legitimate — a client gating on voice activity only sends while
    // someone is speaking. A sequence that does not advance is not: it means a
    // replayed or reordered frame, which would corrupt the utterance.
    if (frame.sequence <= session.lastSequence) {
      this.fail(socket, 'frame_rejected', 'Frame sequence did not advance');
      return;
    }

    session.sampleRate ??= frame.sampleRate;
    if (frame.sampleRate !== session.sampleRate) {
      this.fail(
        socket,
        'frame_rejected',
        `Frame sample rate ${frame.sampleRate} differs from the turn's ${session.sampleRate}`,
      );
      return;
    }

    const audio = Buffer.from(frame.payload, 'base64');
    if (session.bufferedBytes + audio.length > MAX_TURN_BYTES) {
      this.fail(
        socket,
        'turn_too_long',
        `A turn may not exceed ${MAX_TURN_SECONDS}s of audio`,
      );
      this.close(socket, 'turn_too_long');
      return;
    }

    session.chunks.push(audio);
    session.bufferedBytes += audio.length;
    session.lastSequence = frame.sequence;

    this.readPartial(socket, session);
  }

  /**
   * Re-read the turn so far and push what the speaker has said to their screen.
   *
   * Driven by arriving audio rather than by a timer, which is why nothing here
   * needs tearing down. A client that closes its tab mid-sentence stops sending
   * frames, so the reading stops by itself; a timer would have kept decoding a
   * dead session's buffer until someone remembered to cancel it.
   *
   * Failure is swallowed on purpose. A live transcript is a courtesy — the turn
   * is answered by `end()` regardless — so a recogniser that stumbles here must
   * not put an error in front of someone who is still talking, and an
   * unobserved rejection would take the process down.
   */
  private readPartial(socket: StreamSocket, session: StreamSession): void {
    if (session.sampleRate === null) return;
    if (!session.partials.shouldStart(session.bufferedBytes)) return;

    const atBytes = session.bufferedBytes;
    session.partials.markStarted(atBytes);

    void this.pipeline
      .transcribe({
        audio: this.assembleWav(session, this.partialWindowStart(session)),
        mimeType: 'audio/wav',
        direction: session.direction,
      })
      .then((text) => {
        // Checked here, not only before starting: the turn may have ended, or
        // the client left, while this was decoding.
        if (!this.isActive(socket, session)) return;
        if (session.phase !== 'listening') return;
        if (!session.partials.shouldEmit(atBytes)) return;
        if (!text.trim()) return;

        session.partials.markEmitted(atBytes);
        this.emit(socket, {
          type: 'server.transcript.partial',
          text,
          speaker: this.speakerOf(session),
          direction: session.direction,
        });
        this.translateLive(socket, session, text, atBytes);
      })
      .catch((err: unknown) => {
        this.logger.debug(
          `partial read failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => session.partials.markSettled());
  }

  /**
   * Translate a sentence that is still being spoken, if it is worth the request.
   *
   * Only the text is shown; no audio is ever synthesized from it. The sentence
   * is unfinished, so the translation is a guess that the rest of the speech can
   * overturn — and a guess can be quietly replaced on screen, while a guess
   * spoken aloud cannot be taken back.
   *
   * Fails silently for the same reason the live transcript does, with one
   * addition: its model has no fallback, so a rate limit here simply means the
   * live translation stops appearing while the turn itself is unaffected.
   */
  private translateLive(
    socket: StreamSocket,
    session: StreamSession,
    transcript: string,
    atBytes: number,
  ): void {
    const bytesPerSecond = (session.sampleRate ?? 16000) * INBOUND_CHANNELS * 2;
    const seconds = atBytes / bytesPerSecond;
    if (!session.liveTranslation.shouldTranslate(transcript, seconds)) return;

    session.liveTranslation.markStarted(transcript);

    void this.pipeline
      .translate({
        text: transcript,
        direction: session.direction,
        models: LIVE_TRANSLATION_MODELS,
      })
      .then((text) => {
        if (!this.isActive(socket, session)) return;
        // The finished translation has replaced this on screen already; putting
        // a guess back under it would read as the app losing the answer.
        if (session.phase !== 'listening') return;

        this.emit(socket, {
          type: 'server.translation.partial',
          text,
          direction: session.direction,
        });
      })
      .catch((err: unknown) => {
        this.logger.debug(
          `live translation skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => session.liveTranslation.markSettled());
  }

  /** Byte offset the live transcript should start reading the turn from. */
  private partialWindowStart(session: StreamSession): number {
    const bytesPerSecond = (session.sampleRate ?? 16000) * INBOUND_CHANNELS * 2;
    return session.partials.windowStart(session.bufferedBytes, bytesPerSecond);
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
   * {@link MAX_SPECULATIONS_PER_TURN} bounds how much more.
   */
  speculate(socket: StreamSocket): void {
    const session = this.sessions.get(socket);
    if (
      !session ||
      session.phase !== 'listening' ||
      !session.bufferedBytes ||
      session.sampleRate === null
    ) {
      return;
    }
    // Nothing new to transcribe: a second guess over identical audio would buy
    // an identical answer for another request.
    if (session.speculation?.atBytes === session.bufferedBytes) return;
    // A client that suspects the end constantly must not be able to spend the
    // quota of one that talks normally.
    if (session.speculations >= MAX_SPECULATIONS_PER_TURN) return;

    const atBytes = session.bufferedBytes;
    const work = this.pipeline.transcribeAndTranslate({
      audio: this.assembleWav(session),
      mimeType: 'audio/wav',
      direction: session.direction,
      models: SPECULATION_MODELS,
    });
    // A speculation the endpoint never confirms is thrown away unawaited, and
    // an unobserved rejection would take the process down. This matters more
    // now than it did: every guess but the last is discarded by design.
    work.catch(() => undefined);

    // The superseded guess is dropped rather than cancelled — the pipeline has
    // no cancellation, so its cost is already spent either way.
    session.speculation = { atBytes, work, startedAt: Date.now() };
    session.speculations += 1;
  }

  /** Close the turn: transcribe, translate, synthesize, stream the result. */
  async end(socket: StreamSocket): Promise<void> {
    const session = this.sessions.get(socket);
    if (!session) {
      this.fail(socket, 'no_active_session', 'No turn is open');
      return;
    }
    if (session.phase !== 'listening') {
      this.fail(socket, 'session_busy', 'The turn is already being translated');
      return;
    }
    if (!session.bufferedBytes || session.sampleRate === null) {
      this.fail(socket, 'no_audio', 'The turn carried no audio');
      this.close(socket, 'no_audio');
      return;
    }

    session.phase = 'translating';
    const endpointAt = Date.now();
    let translatedAt: number | undefined;
    let clauseCount = 0;
    let speculationUsed = false;
    let firstAudioAt: number | undefined;
    let lastAudioAt: number | undefined;
    let targetChars = 0;

    try {
      // A speculation is only usable if no further audio arrived after it
      // started — otherwise it transcribed a different utterance to the one
      // being ended.
      speculationUsed = session.speculation?.atBytes === session.bufferedBytes;
      const translated = speculationUsed
        ? await session.speculation!.work
        : await this.pipeline.transcribeAndTranslate({
            audio: this.assembleWav(session),
            mimeType: 'audio/wav',
            direction: session.direction,
            models: FINAL_MODELS,
          });
      translatedAt = Date.now();
      targetChars = translated.targetText.length;

      // The client may have gone while the pipeline was working; finishing the
      // turn for nobody costs real quota and writes to a closed socket.
      if (!this.isActive(socket, session)) return;

      this.emit(socket, {
        type: 'server.transcript.final',
        segment: this.toSegment(
          session,
          translated.sourceText,
          translated.targetText,
        ),
      });

      const clauses = splitIntoClauses(translated.targetText);
      clauseCount = clauses.length;
      const timing = await this.streamClauses(
        socket,
        session,
        clauses,
        translated.targetLanguage,
      );
      firstAudioAt = timing.firstAudioAt;
      lastAudioAt = timing.lastAudioAt;

      this.recordTurn(session, {
        completed: true,
        endpointAt,
        translatedAt,
        firstAudioAt,
        lastAudioAt,
        targetChars,
        clauses: clauseCount,
        speculationUsed,
      });

      this.close(socket, 'completed');
    } catch (err) {
      // Recorded on the way out too, so a latency table cannot mistake an
      // unwritten failure for the absence of failures.
      this.recordTurn(session, {
        completed: false,
        endpointAt,
        translatedAt,
        firstAudioAt,
        lastAudioAt,
        targetChars,
        clauses: clauseCount,
        speculationUsed,
      });
      this.reportTurnFailure(socket, session, err);
      this.close(socket, 'error');
    }
  }

  /** True while this socket's turn is still the one the map holds. */
  private isActive(socket: StreamSocket, session: StreamSession): boolean {
    return this.sessions.get(socket) === session;
  }

  private recordTurn(
    session: StreamSession,
    timing: {
      completed: boolean;
      endpointAt: number;
      translatedAt?: number;
      firstAudioAt?: number;
      lastAudioAt?: number;
      targetChars: number;
      clauses: number;
      speculationUsed: boolean;
    },
  ): void {
    // A stage that never ran is reported as the time the turn gave up, which
    // keeps every column a real elapsed measurement rather than a sentinel.
    const fallback = timing.translatedAt ?? Date.now();
    this.metrics.record({
      sessionId: session.sessionId,
      direction: session.direction,
      completed: timing.completed,
      inputBytes: session.bufferedBytes,
      inputSampleRate: session.sampleRate ?? 0,
      targetChars: timing.targetChars,
      clauses: timing.clauses,
      speculationUsed: timing.speculationUsed,
      speculations: session.speculations,
      translatedAtMs: fallback - timing.endpointAt,
      firstAudioAtMs: (timing.firstAudioAt ?? fallback) - timing.endpointAt,
      lastAudioAtMs: (timing.lastAudioAt ?? fallback) - timing.endpointAt,
    });
  }

  /** Drop state for a socket that went away without ending its turn. */
  disconnect(socket: StreamSocket): void {
    const session = this.sessions.get(socket);
    if (!session) return;
    this.sessions.delete(socket);
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
    session: StreamSession,
    clauses: string[],
    language: TranslatedTurnText['targetLanguage'],
  ): Promise<{ firstAudioAt?: number; lastAudioAt?: number }> {
    let firstAudioAt: number | undefined;
    let lastAudioAt: number | undefined;

    for (const clause of clauses) {
      // Checked every iteration: a client that left mid-turn must not keep the
      // CPU synthesizing clauses nobody will hear.
      if (!this.isActive(socket, session)) break;

      const speech = await this.pipeline.synthesize({ text: clause, language });
      const sent = this.emitSynthesizedAudio(
        socket,
        session,
        Buffer.from(speech.bytes),
        speech.mimeType,
      );
      if (!sent) break; // the backend's format was reported; stop the turn's audio
      firstAudioAt ??= Date.now();
      lastAudioAt = Date.now();
    }

    return { firstAudioAt, lastAudioAt };
  }

  /**
   * Concatenate the turn's frames into the container the STT sidecar needs.
   *
   * `fromByte` lets the live transcript read only the newest stretch of a long
   * turn; the final decode always passes 0 and reads the whole thing.
   */
  private assembleWav(session: StreamSession, fromByte = 0): Buffer {
    const samples = Buffer.concat(session.chunks);
    // PyAV opens a container, so the raw frames need a header before the
    // sidecar will decode them.
    return encodePcm16Wav({
      samples: fromByte > 0 ? samples.subarray(fromByte) : samples,
      sampleRate: session.sampleRate ?? 16000,
      channels: INBOUND_CHANNELS,
    });
  }

  /**
   * Which side of the conversation is speaking.
   *
   * A turn is only ever spoken by the side whose language it translates away
   * from, so the direction says who it is.
   */
  private speakerOf(session: StreamSession): 'speaker_a' | 'speaker_b' {
    return session.direction === 'vi_to_en' ? 'speaker_a' : 'speaker_b';
  }

  /**
   * Split synthesized audio into raw PCM frames. Returns false when the payload
   * could not be framed.
   *
   * The shared contract carries samples, not containers, so the WAV the TTS
   * sidecar returns is unwrapped here. A backend that emits anything else — the
   * ElevenLabs path returns `audio/mpeg` — cannot feed this route, and saying so
   * beats shipping frames the client would decode as noise.
   */
  private emitSynthesizedAudio(
    socket: StreamSocket,
    session: StreamSession,
    audio: Buffer,
    mimeType: string,
  ): boolean {
    let pcm;
    try {
      pcm = decodeWavToPcm16(audio);
    } catch (err) {
      const detail = err instanceof WavFormatError ? err.message : String(err);
      this.logger.error(`cannot frame ${mimeType} output: ${detail}`);
      this.fail(
        socket,
        'unsupported_audio',
        `The configured TTS backend returns ${mimeType}; the streaming path needs 16-bit PCM WAV`,
      );
      return false;
    }

    const bytesPerFrame =
      Math.max(1, Math.round((pcm.sampleRate * OUTBOUND_FRAME_MS) / 1000)) *
      pcm.channels *
      2;

    for (let offset = 0; offset < pcm.samples.length; offset += bytesPerFrame) {
      const slice = pcm.samples.subarray(offset, offset + bytesPerFrame);
      this.emit(socket, {
        type: 'server.audio.frame',
        frame: {
          sessionId: session.sessionId,
          encoding: 'pcm16',
          sampleRate: pcm.sampleRate,
          sequence: session.outboundSequence++,
          timestamp: Date.now(),
          payload: slice.toString('base64'),
        },
      });
    }
    return true;
  }

  private toSegment(
    session: StreamSession,
    sourceText: string,
    targetText: string,
  ): TranscriptSegment {
    return {
      id: randomUUID(),
      sessionId: session.sessionId,
      speakerRole: this.speakerOf(session),
      direction: session.direction,
      sourceText,
      targetText,
      // Audio travels over this socket rather than being stored.
      audioUrl: null,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Report a failed turn. The pipeline already maps provider faults onto HTTP
   * exceptions for the REST path, so their messages are reused rather than
   * re-derived — a client should not get a different explanation of the same
   * fault depending on which transport it used.
   */
  private reportTurnFailure(
    socket: StreamSocket,
    session: StreamSession,
    err: unknown,
  ): void {
    const message =
      err instanceof HttpException ? err.message : 'Translation failed';
    this.logger.error(
      `turn ${session.sessionId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    this.fail(socket, 'turn_failed', message);
  }

  private close(socket: StreamSocket, reason: string): void {
    this.sessions.delete(socket);
    this.emit(socket, { type: 'server.session.ended', reason });
  }

  private fail(socket: StreamSocket, code: string, message: string): void {
    this.emit(socket, { type: 'server.error', code, message });
  }

  private emit(socket: StreamSocket, event: ServerEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch (err) {
      // A socket that closed underneath us surfaces here. `ws` reports a send
      // after close as an error event when no callback is given, and an
      // unhandled one would take the process down for a client that already
      // left, so this is swallowed rather than propagated into the turn.
      this.logger.warn(
        `dropped ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

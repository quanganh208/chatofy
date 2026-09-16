import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientTurnMetrics } from '@chatofy/types';
import type { Env } from '../../../config/env.schema';
import { MetricsJsonlSink } from './metrics-jsonl-sink';

/**
 * One streamed turn, timed stage by stage. Every duration is milliseconds from
 * the moment the client said the turn was over, which is the only origin the
 * user can perceive.
 */
export interface TurnMetrics {
  sessionId: string;
  direction: string;
  /**
   * False when the turn failed part-way. Recorded either way: a latency table
   * built from success rows alone cannot tell "no failures" from "failures not
   * written down".
   */
  completed: boolean;
  /**
   * How the turn ended, when it was not the ordinary way.
   *
   * The recorder used to be called only on the paths that produced audio, which
   * meant `no_audio`, `turn_too_long` and a client that left mid-turn wrote no row
   * at all. `LivePreview` has already spent quota by then, so requests-per-minute
   * computed from this file read LOWER than reality — and continuous capture is
   * the mode that generates the most of exactly those turns. Every termination
   * path writes a row now, and this says which one it was.
   */
  reason?: string;
  /** Bytes of microphone audio the turn carried. */
  inputBytes: number;
  /** Sample rate the client captured at. */
  inputSampleRate: number;
  /** Text produced by transcription + translation. */
  targetChars: number;
  /** Clause-level synthesis units the translation was split into. */
  clauses: number;
  /**
   * True when a `client.turn.speculate` result was still valid at endpoint, so
   * transcription and translation had already run ahead of it.
   */
  speculationUsed: boolean;
  /**
   * Guesses this turn started. Every one is a translation request, and all but
   * the last are discarded, so this is what the head start costs — recorded so
   * a latency table cannot show the saving without the bill beside it.
   */
  speculations: number;
  /**
   * Provisional translations this turn spent.
   *
   * Each is a metered request that is never spoken aloud, so this is the part of
   * the bill the latency table could not see before: the saving showed up in
   * `firstAudioAtMs` while its cost sat in no column at all. Rows written before
   * 2026-07 have no such key, so a reader must tolerate it being absent rather
   * than assume zero.
   */
  liveTranslations: number;
  /**
   * Rate limits this process had been told about by the time the turn ended.
   *
   * Cumulative across the process, not per turn, so what a reader wants is the
   * DIFFERENCE between two rows — a turn that raised it spent into a cooldown.
   *
   * It exists so acceptance can measure something real. A previous plan gated on
   * grepping this file for a string that only ever reached a log line, so the
   * gate reported zero whatever happened and could not fail.
   */
  quotaCooldowns: number;
  /**
   * Times this turn REPLACED settled transcript text rather than extending it.
   *
   * Acceptance caps this, and until now the cap could not be checked at all:
   * the count lived on the committer and died with the turn. A ratio above
   * roughly one every other turn means the recogniser is settling text it has
   * to take back, which on screen reads as the line rewriting itself.
   */
  reanchors: number;
  /**
   * Characters of transcript that had settled by the time the turn ended.
   *
   * The mid-sentence translation fires on newly settled characters, so a turn
   * that never translated early is either a turn that said little or a turn
   * whose text never settled — and those want opposite fixes. Without this
   * column the two are indistinguishable in the metrics, which is exactly the
   * ambiguity that cost a round of guessing at a short-sentence complaint.
   */
  committedChars: number;
  /** Endpoint → translation ready. Negative when speculation finished first. */
  translatedAtMs: number;
  /** Endpoint → first audio byte pushed to the client. The headline number. */
  firstAudioAtMs: number;
  /** Endpoint → last audio byte pushed. */
  lastAudioAtMs: number;
}

/**
 * The two turn sources — `server` and `client` — land in one file because the
 * halves are useless separately: the server knows what a turn cost and the
 * client knows what the listener experienced, and the interesting numbers are
 * ratios across the join. They are joined on `sessionId` and never by timestamp
 * — see {@link ClientTurnMetricsRow}. A third source, `live`, shares the file
 * but joins with neither: it describes a whole session on the continuous path,
 * which is not the same unit as a turn. The enum itself lives with the sink, in
 * `metrics-jsonl-sink.ts`.
 */

/** One turn as the client experienced it, ready to be written. */
export interface ClientTurnMetricsRow extends ClientTurnMetrics {
  /**
   * The turn's session id, already matched against a turn the sending socket owns.
   *
   * That match is an exact comparison against an id this server generated, so by the
   * time a row reaches here the value is one of our own UUIDs and is safe to put in a
   * log line. It is still the client's string by provenance — the check is what makes it
   * trustworthy, not where it came from — which is why nothing else from the payload is
   * logged.
   *
   * The times in this row are in the CLIENT's clock and must never be subtracted from a
   * server timestamp.
   */
  sessionId: string;
}

/**
 * Appends one JSON line per streamed turn, from either side.
 *
 * Off unless `TURN_METRICS_PATH` is set: a latency table is something you go
 * and collect, not a file the API grows on every deployment. Writes are
 * fire-and-forget — a metrics sink must never add latency to, or fail, the turn
 * it is measuring.
 */
@Injectable()
export class TurnMetricsRecorder {
  private readonly logger = new Logger(TurnMetricsRecorder.name);
  /**
   * The shared append machinery. The continuous path builds its own instance
   * over the same file rather than borrowing this one — two appenders on one
   * path, which is safe because each row is a single small `appendFile` and the
   * `source` field is what a reader filters on. A turn and a session are not
   * the same unit and must never be compared without that filter.
   */
  private readonly sink: MetricsJsonlSink;

  constructor(config: ConfigService<Env, true>) {
    this.sink = new MetricsJsonlSink(
      config.get('TURN_METRICS_PATH', { infer: true }),
      this.logger,
    );
  }

  record(metrics: TurnMetrics): void {
    this.logger.log(
      `turn ${metrics.sessionId} ${metrics.completed ? 'ok' : 'FAILED'}` +
        `${metrics.reason ? ` (${metrics.reason})` : ''} ` +
        `firstAudio=${metrics.firstAudioAtMs}ms translated=${metrics.translatedAtMs}ms ` +
        `clauses=${metrics.clauses} ` +
        `speculation=${metrics.speculationUsed ? 'hit' : 'miss'}/${metrics.speculations} ` +
        `live=${metrics.liveTranslations}`,
    );
    this.sink.append('server', metrics);
  }

  /**
   * Record what the client measured for a turn.
   *
   * The caller must already have established that the socket owns this turn. Two
   * things follow from that and both matter: the id in the log line below is the
   * server's own, and nothing else from the payload is logged at all. Every field
   * is bounded by the contract, but a bounded string is still a string a client
   * chose, and log lines are read by people and parsed by machines.
   */
  recordClient(metrics: ClientTurnMetricsRow): void {
    this.logger.log(
      `turn ${metrics.sessionId} client outcome=${metrics.outcome} ` +
        `captured=${metrics.capturedMs}ms held=${metrics.heldMs}ms ` +
        `cut=${metrics.cutForced ? 'forced' : 'hangover'} echo=${metrics.echoEvents}`,
    );
    this.sink.append('client', metrics);
  }
}

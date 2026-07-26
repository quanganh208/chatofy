import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Env } from '../../../config/env.schema';

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
  /** Endpoint → translation ready. Negative when speculation finished first. */
  translatedAtMs: number;
  /** Endpoint → first audio byte pushed to the client. The headline number. */
  firstAudioAtMs: number;
  /** Endpoint → last audio byte pushed. */
  lastAudioAtMs: number;
}

/**
 * Appends one JSON line per streamed turn.
 *
 * Off unless `TURN_METRICS_PATH` is set: a latency table is something you go
 * and collect, not a file the API grows on every deployment. Writes are
 * fire-and-forget — a metrics sink must never add latency to, or fail, the turn
 * it is measuring.
 */
@Injectable()
export class TurnMetricsRecorder {
  private readonly logger = new Logger(TurnMetricsRecorder.name);
  private readonly path?: string;
  /** Directory creation is attempted once, not on every turn. */
  private ready?: Promise<void>;
  /** One warning per process; a broken sink must not flood the log. */
  private warned = false;

  constructor(config: ConfigService<Env, true>) {
    this.path = config.get('TURN_METRICS_PATH', { infer: true });
  }

  record(metrics: TurnMetrics): void {
    this.logger.log(
      `turn ${metrics.sessionId} ${metrics.completed ? 'ok' : 'FAILED'} ` +
        `firstAudio=${metrics.firstAudioAtMs}ms translated=${metrics.translatedAtMs}ms ` +
        `clauses=${metrics.clauses} ` +
        `speculation=${metrics.speculationUsed ? 'hit' : 'miss'}/${metrics.speculations}`,
    );

    const path = this.path;
    if (!path) return;

    this.ready ??= mkdir(dirname(path), { recursive: true }).then(
      () => undefined,
    );
    void this.ready
      .then(() => appendFile(path, `${JSON.stringify(metrics)}\n`, 'utf8'))
      .catch((err: unknown) => {
        if (this.warned) return;
        this.warned = true;
        this.logger.warn(
          `turn metrics disabled — cannot write ${path}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}

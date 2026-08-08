import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { MetricsJsonlSink } from './metrics-jsonl-sink';

/**
 * One continuous session, start to finish.
 *
 * A session, not a turn, and the difference is why this is not a `TurnMetrics`
 * with fields renamed. Every column in `TurnMetrics` is milliseconds from a
 * client-declared endpoint, and this path has no endpoint — the model
 * translates while the speaker is still talking. Reusing that shape would
 * produce numbers that sit in the same columns as the cascade's and mean
 * something else, which is worse than having no numbers.
 *
 * These rows are OPERATIONAL TELEMETRY, not thesis evidence. The comparable
 * per-utterance figures come from the Phase 4 runner, which measures both arms
 * at its own boundary so neither is advantaged by where the clock was read.
 */
export interface LiveSessionMetrics {
  sessionId: string;
  direction: string;
  /** Wall-clock length of the session, in ms. */
  durationMs: number;
  /** Microphone bytes forwarded upstream. Continuous capture, so this is large. */
  inputBytes: number;
  /** Milliseconds of translated audio pushed back. */
  outputAudioMs: number;
  sourceChars: number;
  targetChars: number;
  /**
   * Deltas whose detected language was not the direction's source.
   *
   * The docs warn auto-detection struggles with similar languages and heavy
   * accents, so this is the column that says whether that warning bit us. Zero
   * is a result; the absence of the column would not be.
   */
  languageMismatches: number;
  /**
   * How long the upstream session took to open, and to answer.
   *
   * Recorded so model latency can later be separated from this server's own
   * overhead. Cheap to stamp now and impossible to add afterwards without
   * re-running the fixture set.
   */
  upstreamConnectMs: number;
  firstUpstreamByteMs?: number;
  reason: string;
}

/**
 * Appends one JSON line per continuous session.
 *
 * Shares `TURN_METRICS_PATH` and the sink with the turn recorder: one file, and
 * rows told apart by `source`. A reader must filter on it before comparing
 * anything, because a `live` row describes a session and a `server` row
 * describes a turn.
 */
@Injectable()
export class LiveSessionMetricsRecorder {
  private readonly logger = new Logger(LiveSessionMetricsRecorder.name);
  private readonly sink: MetricsJsonlSink;

  constructor(config: ConfigService<Env, true>) {
    this.sink = new MetricsJsonlSink(
      config.get('TURN_METRICS_PATH', { infer: true }),
      this.logger,
    );
  }

  record(metrics: LiveSessionMetrics): void {
    this.logger.log(
      `live ${metrics.sessionId} ${metrics.direction} (${metrics.reason}) ` +
        `duration=${metrics.durationMs}ms in=${metrics.inputBytes}B ` +
        `out=${metrics.outputAudioMs}ms connect=${metrics.upstreamConnectMs}ms ` +
        `firstByte=${metrics.firstUpstreamByteMs ?? '-'}ms ` +
        `langMismatch=${metrics.languageMismatches}`,
    );
    this.sink.append('live', metrics);
  }
}

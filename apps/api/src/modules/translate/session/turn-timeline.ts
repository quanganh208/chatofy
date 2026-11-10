import type {
  FinalSourceDiagnostics,
  TurnMetrics,
} from '../services/turn-metrics.recorder';
import { quotaCooldownCount } from '../quota-cooldown-meter';
import type { TurnAudio } from './turn-audio';
import type { TurnSession } from './turn-session';

/** When each stage of a turn finished, as the audio path reported it. */
export interface AudioSpan {
  firstAudioAt?: number;
  lastAudioAt?: number;
}

/** How a turn's speech reached the backend: one streamed request, or clause by clause. */
export type TtsDelivery = NonNullable<TurnMetrics['ttsDelivery']>;

/**
 * That same report, plus why delivery stopped early when it did.
 *
 * The stops are not interchangeable. `client_gone` means there is nobody left
 * to tell and nothing worth measuring; `unsupported_audio` means the listener is
 * still there and has been told, but heard less than the whole turn.
 * `engine_busy` means the speech engine served another turn in this language for
 * longer than this one could wait: the transcript went out and the turn ends
 * without audio, as an outcome of sharing one engine rather than as a fault.
 */
export interface ClauseDelivery extends AudioSpan {
  /**
   * `voice_off` is a SUCCESSFUL turn that was never meant to be spoken, and it is
   * carried as its own reason rather than left undefined so nothing downstream has
   * to guess. Without it a text-only turn is recorded `completed` with no reason,
   * and `toMetrics` falls its first-audio time back to the translation time — a
   * row indistinguishable from a turn whose synthesis returned in zero
   * milliseconds, which silently deflates every time-to-first-audio percentile in
   * proportion to how many people turned speech off.
   */
  stoppedBy?: 'client_gone' | 'unsupported_audio' | 'voice_off' | 'engine_busy';
}

/**
 * A named point in a turn's critical path, in the order a turn passes them.
 *
 * The union's order is the log line's order, so a reader can rely on where a
 * stage sits without parsing keys. Each is milliseconds from the endpoint like
 * every other column here, except `alternateWait`, which is a DURATION: how
 * long the recognizer held its answer for the second reading, as the sidecar
 * measured it, with no origin of its own on this clock.
 *
 * A stage a reused speculation reached before `end()` comes out negative,
 * exactly as `translatedAtMs` does: it was done before the endpoint was.
 */
export const TURN_STAGES = [
  'sttDone',
  'alternateWait',
  'mtFirstToken',
  'mtDone',
  'restoreDone',
  'correctionsDone',
  'translationsReady',
  'lineSent',
  'embeddingDone',
  'ttsRequested',
] as const;
export type TurnStage = (typeof TURN_STAGES)[number];

/** Stages as the timeline reports them; absent means the turn never got there. */
export type TurnStages = Partial<Record<TurnStage, number>>;

/**
 * A stage reached before there was a timeline to mark it on — by a
 * speculation, which runs ahead of `end()`. `at` is an absolute clock reading;
 * `durationMs` is set for a duration stage (`alternateWait`) instead.
 */
export interface TimedStage {
  stage: TurnStage;
  at: number;
  durationMs?: number;
}

/**
 * An `onStage` listener that keeps what it hears for a timeline that does not
 * exist yet; see {@link TurnTimeline.replay}.
 */
export function bufferStages(
  into: TimedStage[],
  now: () => number = Date.now,
): (stage: TurnStage, durationMs?: number) => void {
  return (stage, durationMs) => {
    into.push({
      stage,
      at: now(),
      ...(durationMs === undefined ? {} : { durationMs }),
    });
  };
}

/**
 * Stopwatch for one turn, from the endpoint the client declared.
 *
 * Every column is milliseconds from that endpoint because it is the only origin
 * the speaker can perceive — they said their piece, and everything after is
 * waiting. The clock is injected so a spec can measure without sleeping.
 */
export class TurnTimeline {
  private readonly endpointAt: number;
  private translatedAt?: number;
  private firstAudioAt?: number;
  private lastAudioAt?: number;
  private targetChars = 0;
  private clauses = 0;
  private ttsDelivery?: TtsDelivery;
  private speculationUsed = false;
  private finalSource?: FinalSourceDiagnostics;
  private readonly stages: TurnStages = {};
  private speculationInFlight?: boolean;
  private correctionsWereLate?: boolean;
  private splitCandidate?: boolean;
  private fused?: number;

  constructor(private readonly now: () => number = Date.now) {
    this.endpointAt = this.now();
  }

  /**
   * Whether the endpoint found a usable guess waiting.
   *
   * Marked before the pipeline is awaited, not after: a turn that then fails
   * still has to report whether it was riding a guess, and a stamp taken after
   * the await never happens on that path.
   */
  markSpeculationReused(used: boolean): void {
    this.speculationUsed = used;
  }

  /** Whether the endpoint ended up using a speculation's answer. */
  get reusedSpeculation(): boolean {
    return this.speculationUsed;
  }

  /** How the final's source text was produced; see {@link FinalSourceDiagnostics}. */
  markFinalSource(diagnostics: FinalSourceDiagnostics): void {
    this.finalSource = diagnostics;
  }

  /**
   * When a stage of the critical path finished.
   *
   * The FIRST stamp wins. A turn can pass a stage twice — a speculation's
   * pipeline and then the final's, or the split path after its plain attempt —
   * and the one the reader waited on is the earliest that was used; a later
   * repeat would hide the head start the first one bought. `at` is an absolute
   * clock reading, so a stage buffered by a speculation before this timeline
   * existed is replayed with its own time and comes out negative.
   */
  markStage(stage: TurnStage, at: number = this.now()): void {
    this.stages[stage] ??= at - this.endpointAt;
  }

  /**
   * A stage that is a measured duration rather than a point in time; today
   * only the recognizer's wait for its alternate. First value wins, as above.
   */
  markDuration(stage: 'alternateWait', ms: number): void {
    this.stages[stage] ??= ms;
  }

  /**
   * The pipeline's `onStage` listener for this turn: a stage that comes with a
   * duration is one, every other is a moment. Bound, so it can be handed over
   * as it is.
   */
  readonly onStage = (stage: TurnStage, durationMs?: number): void => {
    if (stage === 'alternateWait' && durationMs !== undefined) {
      this.markDuration(stage, durationMs);
    } else {
      this.markStage(stage);
    }
  };

  /** Stages a speculation buffered, at the times it reached them. */
  replay(stages: readonly TimedStage[]): void {
    for (const { stage, at, durationMs } of stages) {
      if (stage === 'alternateWait' && durationMs !== undefined) {
        this.markDuration(stage, durationMs);
      } else {
        this.markStage(stage, at);
      }
    }
  }

  /**
   * Whether the reused speculation was still running when `end()` adopted it.
   *
   * A hit that was still in flight saved only part of the pipeline; without
   * this, a table split by reuse would credit it with the whole head start.
   */
  markSpeculationInFlight(inFlight: boolean): void {
    this.speculationInFlight = inFlight;
  }

  /** The transcript checks missed their grace and the line went without them. */
  markCorrectionsLate(): void {
    this.correctionsWereLate = true;
  }

  /**
   * Whether the turn's audio could hold a change of voice, decided before
   * anything is spent. Such a turn takes the split path whether or not it is
   * finally split, so a table of the plain path has to leave all of them out.
   */
  markSplitCandidate(candidate: boolean): void {
    this.splitCandidate = candidate;
  }

  /**
   * How many recognizer-fusion corrections the turn's final line carried.
   * Marked only where the fusion ran, so absent and zero stay different.
   */
  markFused(applied: number): void {
    this.fused = applied;
  }

  markTranslated(translation: string): void {
    this.translatedAt = this.now();
    this.targetChars = translation.length;
  }

  /**
   * How many synthesis requests the turn's speech took, and which path took
   * them. Clause by clause that is the clause count; a streamed turn is ONE
   * request, however the backend cut it up inside, so it records 1. The path is
   * recorded beside it because `1` alone cannot tell a streamed turn from a
   * one-clause fallback — and a sidecar that silently stopped streaming would
   * otherwise leave no trace in the rows.
   */
  markClauses(count: number, delivery: TtsDelivery): void {
    this.clauses = count;
    this.ttsDelivery = delivery;
  }

  /**
   * Take the span the audio path measured.
   *
   * Handed in whole rather than stamped per clause so that a synthesis failure
   * mid-turn leaves the audio columns unset, exactly as before — a turn that
   * broke after two of five clauses reports the fallback, not a first-audio time
   * that makes it look like it delivered.
   */
  markAudio(span: AudioSpan): void {
    this.firstAudioAt ??= span.firstAudioAt;
    this.lastAudioAt = span.lastAudioAt ?? this.lastAudioAt;
  }

  toMetrics(
    session: TurnSession,
    audio: TurnAudio | null,
    completed: boolean,
    reason?: string,
  ): TurnMetrics {
    // A stage that never ran is reported as the time the turn gave up, which
    // keeps every column a real elapsed measurement rather than a sentinel.
    const fallback = this.translatedAt ?? this.now();
    return {
      sessionId: session.sessionId,
      languagePair: session.languagePair,
      completed,
      reason,
      // Nullable because a turn can end before any frame fixed a sample rate —
      // `no_audio` is exactly that case, and it is one of the paths that used to
      // write no row at all even though the live preview had already spent quota.
      inputBytes: audio?.byteLength ?? 0,
      inputSampleRate: audio?.sampleRate ?? 0,
      targetChars: this.targetChars,
      clauses: this.clauses,
      ...(this.ttsDelivery ? { ttsDelivery: this.ttsDelivery } : {}),
      speculationUsed: this.speculationUsed,
      speculations: session.speculationCount,
      ...(this.finalSource ? { finalSource: this.finalSource } : {}),
      liveTranslations: session.liveTranslation.spentCount,
      quotaCooldowns: quotaCooldownCount(session.liveTranslation.meteredModel),
      reanchors: session.committer.reanchors,
      committedChars: session.committer.committed.length,
      translatedAtMs: fallback - this.endpointAt,
      firstAudioAtMs: (this.firstAudioAt ?? fallback) - this.endpointAt,
      lastAudioAtMs: (this.lastAudioAt ?? fallback) - this.endpointAt,
      // A copy, so a stamp arriving after the row was written cannot edit it.
      stages: { ...this.stages },
      ...(this.speculationInFlight === undefined
        ? {}
        : { speculationInFlightAtEnd: this.speculationInFlight }),
      ...(this.correctionsWereLate ? { correctionsLate: true } : {}),
      ...(this.splitCandidate === undefined
        ? {}
        : { splitCandidate: this.splitCandidate }),
      ...(this.fused === undefined ? {} : { fusedCorrections: this.fused }),
    };
  }
}

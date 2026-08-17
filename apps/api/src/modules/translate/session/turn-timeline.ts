import type { TurnMetrics } from '../services/turn-metrics.recorder';
import type { TurnAudio } from './turn-audio';
import type { TurnSession } from './turn-session';

/** When each stage of a turn finished, as the audio path reported it. */
export interface AudioSpan {
  firstAudioAt?: number;
  lastAudioAt?: number;
}

/**
 * That same report, plus why delivery stopped early when it did.
 *
 * The two stops are not interchangeable. `client_gone` means there is nobody
 * left to tell and nothing worth measuring; `unsupported_audio` means the
 * listener is still there and has been told, but heard less than the whole turn.
 */
export interface ClauseDelivery extends AudioSpan {
  stoppedBy?: 'client_gone' | 'unsupported_audio';
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
  private speculationUsed = false;

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

  markTranslated(targetText: string): void {
    this.translatedAt = this.now();
    this.targetChars = targetText.length;
  }

  markClauses(count: number): void {
    this.clauses = count;
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
      direction: session.direction,
      completed,
      reason,
      // Nullable because a turn can end before any frame fixed a sample rate —
      // `no_audio` is exactly that case, and it is one of the paths that used to
      // write no row at all even though the live preview had already spent quota.
      inputBytes: audio?.byteLength ?? 0,
      inputSampleRate: audio?.sampleRate ?? 0,
      targetChars: this.targetChars,
      clauses: this.clauses,
      // Read off the session rather than tracked here: the clauses were spoken
      // by the commit driver, on frames this timeline never saw.
      committedClauses: session.spokenCount,
      firstCommitAfterStartMs: session.spokenTimings[0] ?? null,
      commitOffsetsMs: session.spokenTimings,
      clauseAudioOffsetsMs: session.clauseAudioTimings,
      commitContradictions: session.commitStats()?.contradictions ?? 0,
      speculationUsed: this.speculationUsed,
      speculations: session.speculationCount,
      liveTranslations: session.liveTranslation.spentCount,
      translatedAtMs: fallback - this.endpointAt,
      firstAudioAtMs: (this.firstAudioAt ?? fallback) - this.endpointAt,
      lastAudioAtMs: (this.lastAudioAt ?? fallback) - this.endpointAt,
    };
  }
}

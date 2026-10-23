import type { LanguageCode } from '@chatofy/types';
import type { TurnLanguagePlan } from './turn-language-plan';
import {
  LID_CONFIDENT_AT,
  LID_LOCK_CONFIDENCE,
  LID_LOCK_MIN_SPEECH_MS,
  LID_SOURCE_PRIOR_LOGODDS,
  LID_UNCERTAIN_BELOW,
} from './turn-tuning';

/** How a session's turns get their language. */
export type LanguageMode = 'declared' | 'two-way' | 'detect';

/**
 * What one recognition said about the language it heard.
 *
 * `confidence` is the chosen candidate's probability among the candidates, or
 * null when the sidecar could not identify (busy, or one that ignores
 * `candidates`) and `language` is simply the language it was asked to decode.
 */
export interface HeardLanguage {
  readonly language: LanguageCode;
  readonly confidence: number | null;
  /** Speech the decision heard, ms, in the units the lock bar was tuned in. */
  readonly speechMs?: number;
}

/** What an unsure final falls back on, in order. */
export interface FinalFallback {
  /** The decided language of the turn opened before this one, if it is decided. */
  readonly previous: LanguageCode | null;
  /** The declared source; null for a detect session. */
  readonly source: LanguageCode | null;
}

/** Why a final ended up in its language. */
export type DecidedVia = 'declared' | 'model' | 'previous' | 'source';

/**
 * Lean towards the declared source until the session shows both sides.
 *
 * The user picked a source; a two-way conversation most likely opens in it.
 * Once a turn is confidently in another language the bonus is gone for good:
 * a conversation that has shown both sides is symmetric. Per socket, because
 * the evidence is the conversation's, not the turn's.
 */
export class SourcePrior {
  private live = true;

  constructor(
    private readonly source: LanguageCode | null,
    private readonly logOdds = LID_SOURCE_PRIOR_LOGODDS,
  ) {}

  /**
   * `heard`'s confidence once the bonus is applied to the source. Exact for a
   * pair, where the other candidate holds the rest of the probability; a
   * detect session has no source to lean on.
   */
  confidence(heard: HeardLanguage): number | null {
    const { confidence } = heard;
    if (
      confidence === null ||
      !this.live ||
      this.source === null ||
      this.logOdds === 0
    ) {
      return confidence;
    }
    const bonus = Math.exp(this.logOdds);
    return heard.language === this.source
      ? (confidence * bonus) / (confidence * bonus + (1 - confidence))
      : confidence / (confidence + (1 - confidence) * bonus);
  }

  /** Record a final; a confident turn away from the source ends the prior. */
  observe(heard: HeardLanguage): void {
    if (
      heard.confidence !== null &&
      heard.confidence >= LID_CONFIDENT_AT &&
      heard.language !== this.source
    ) {
      this.live = false;
    }
  }
}

/**
 * The language a turn is in, decided in three steps (the policy the bake-off
 * scored, `benchmarks/lid/lid_bench/runtime_policy.py`):
 *
 * 1. **Held**: while unsure, partials carry text but no language, and no live
 *    translation runs. Showing every partial's guess flipped the label on ~38%
 *    of conversational turns.
 * 2. **Locked**: the first partial confident enough and long enough fixes the
 *    language for the rest of the partials and for live translation.
 * 3. **Final**: re-decided on the whole turn, always. It may overrule the lock
 *    — the only way the label changes — and an unsure one falls back.
 *
 * A declared turn is decided before it starts and never changes.
 */
export class TurnLanguageDecision {
  private provisional: LanguageCode;
  private lockedLanguage: LanguageCode | null = null;
  private finalLanguage: LanguageCode | null = null;
  private lastHeard: LanguageCode | null = null;
  private switchCount = 0;
  private lockedAt: number | null = null;
  private decidedVia: DecidedVia | null = null;

  constructor(
    readonly mode: LanguageMode,
    /** Two or more for an identified turn; the declared source alone otherwise. */
    readonly candidates: readonly LanguageCode[],
    /** The language a turn is read in until it is decided: the declared source. */
    initial: LanguageCode,
    private readonly planFor: (language: LanguageCode) => TurnLanguagePlan,
  ) {
    this.provisional = initial;
    if (mode === 'declared') {
      this.lockedLanguage = initial;
      this.finalLanguage = initial;
      this.decidedVia = 'declared';
    }
  }

  /** Whether recognitions of this turn should ask the sidecar which candidate it is. */
  get identifying(): boolean {
    return this.mode !== 'declared';
  }

  /** The language everything reads now: final, else lock, else the provisional guess. */
  get language(): LanguageCode {
    return this.finalLanguage ?? this.lockedLanguage ?? this.provisional;
  }

  get plan(): TurnLanguagePlan {
    return this.planFor(this.language);
  }

  /** The language partials may show, or null while it is held. */
  get locked(): LanguageCode | null {
    return this.lockedLanguage;
  }

  /** Whether the final has been decided. */
  get decided(): boolean {
    return this.finalLanguage !== null;
  }

  /** Whether the final overruled the lock. */
  get overridden(): boolean {
    return (
      this.mode !== 'declared' &&
      this.lockedLanguage !== null &&
      this.finalLanguage !== null &&
      this.finalLanguage !== this.lockedLanguage
    );
  }

  /** How many times consecutive partials heard different languages. */
  get switches(): number {
    return this.switchCount;
  }

  /** Turn time at which the preview locked, or null. */
  get lockedAtMs(): number | null {
    return this.lockedAt;
  }

  get via(): DecidedVia | null {
    return this.decidedVia;
  }

  /**
   * One partial's recognition. Returns true when this partial locked the turn.
   * Ignored once locked or decided: a lock is the preview's one decision.
   */
  observe(heard: HeardLanguage, prior: SourcePrior, atMs: number): boolean {
    if (this.lockedLanguage !== null || this.finalLanguage !== null)
      return false;
    if (!this.candidates.includes(heard.language)) return false;
    if (this.lastHeard !== null && this.lastHeard !== heard.language)
      this.switchCount += 1;
    this.lastHeard = heard.language;
    // Unsure partials are no evidence: the provisional reading stays what it was.
    if (heard.confidence === null) return false;
    this.provisional = heard.language;
    const confidence = prior.confidence(heard) ?? 0;
    if (
      confidence < LID_LOCK_CONFIDENCE ||
      (heard.speechMs ?? 0) < LID_LOCK_MIN_SPEECH_MS
    ) {
      return false;
    }
    this.lockedLanguage = heard.language;
    this.lockedAt = atMs;
    return true;
  }

  /**
   * The final, on the whole turn. `heard` null or unsure (or outside the
   * candidates, which a sidecar that ignored them answers) falls back to the
   * previous turn's language — the one opened before this — and then to the
   * source; a detect turn with neither keeps what it heard.
   */
  decideFinal(
    heard: HeardLanguage | null,
    prior: SourcePrior,
    fallback: FinalFallback,
  ): LanguageCode {
    if (this.mode === 'declared') return this.language;
    const { language, via } = this.peekFinal(heard, prior, fallback);
    this.finalLanguage = language;
    this.decidedVia = via;
    const usable = this.usable(heard);
    if (usable !== null) prior.observe(usable);
    return language;
  }

  /**
   * What {@link decideFinal} would answer, without deciding anything — for a
   * speculation, which must never decide the turn: its answer is only reused
   * if the final, asked the same question at the endpoint, agrees.
   */
  peekFinal(
    heard: HeardLanguage | null,
    prior: SourcePrior,
    fallback: FinalFallback,
  ): { language: LanguageCode; via: DecidedVia } {
    if (this.mode === 'declared')
      return { language: this.language, via: 'declared' };
    const usable = this.usable(heard);
    const confidence = usable === null ? null : prior.confidence(usable);
    if (
      usable !== null &&
      confidence !== null &&
      confidence >= LID_UNCERTAIN_BELOW
    ) {
      return { language: usable.language, via: 'model' };
    }
    if (
      fallback.previous !== null &&
      this.candidates.includes(fallback.previous)
    ) {
      return { language: fallback.previous, via: 'previous' };
    }
    if (fallback.source !== null && this.candidates.includes(fallback.source)) {
      return { language: fallback.source, via: 'source' };
    }
    return { language: usable?.language ?? this.language, via: 'model' };
  }

  /** The plan a turn decided in `language` runs. */
  planIn(language: LanguageCode): TurnLanguagePlan {
    return this.planFor(language);
  }

  /** `heard`, unless it names a language outside the candidates (a sidecar that ignored them). */
  private usable(heard: HeardLanguage | null): HeardLanguage | null {
    return heard !== null && this.candidates.includes(heard.language)
      ? heard
      : null;
  }
}

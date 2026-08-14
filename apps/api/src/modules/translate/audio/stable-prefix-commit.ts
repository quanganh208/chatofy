/**
 * Decides what part of a still-growing transcript is safe to say out loud.
 *
 * Every mistake here is permanent. A word handed to synthesis has been heard by
 * the time a later read disagrees with it, so this file's job is not to be
 * accurate — it is to never be retracted. When in doubt it says nothing and
 * waits, which costs latency; the alternative costs the listener a sentence that
 * contradicts the one before it.
 *
 * Pure and synchronous on purpose, for the same reason `SpeechGate` is: this is
 * the whole policy, and a defect in it is invisible in every log.
 *
 * Two recognisers feed it and they fail in opposite ways.
 *
 * The Vietnamese streaming engine decodes causally and never revisits audio it
 * has consumed, so its prefix is append-only by construction — measured at 0
 * violations across 139 consecutive 300ms feeds. Waiting for repeated reads to
 * agree would buy nothing and cost a round of latency, so that path commits on
 * first sight and merely COUNTS disagreement. A non-zero count there means the
 * architectural claim is false, and the counter is how we would find out.
 *
 * The English engine re-reads a growing buffer and does rewrite itself:
 *
 *   "at a time" -> "at set." -> "at seven in the morning"
 *               -> "at 7 in the Eve" -> "at seven in the evening"
 *
 * so that path waits for successive reads to agree before speaking. The
 * `seven`/`7` half of that is spelling, not meaning, and is absorbed by
 * `normalizeForComparison` rather than by waiting longer.
 */
import {
  commonPrefixLength,
  normalizeForComparison,
  type NormalizerLanguage,
} from './transcript-normalizer';

/**
 * How many successive reads must agree before English text may be spoken.
 *
 * Two, and the evidence for two is narrow enough to state plainly. In the only
 * recorded English run, agreement at depth 2 already held the correct 12-word
 * prefix through the whole unstable region; the single prefix flip it did not
 * hold was `seven` -> `7`, which the normalizer now removes before comparison.
 * Depth 3 would have changed nothing on that run while adding a read of delay.
 *
 * That run is one clean synthesized voice. If phase 6 counts spoken clauses
 * being contradicted, the fix is this constant going to 3 — NOT a looser clause
 * boundary, which trades stability for latency in the wrong direction.
 */
export const AGREEMENT_DEPTH_EN = 2;

/**
 * Vietnamese needs no agreement at all: monotonicity is a property of the
 * decoder, not a statistic. Named rather than inlined so the asymmetry is
 * visible at the call site instead of hiding inside a branch.
 */
export const AGREEMENT_DEPTH_VI = 1;

/**
 * Words to accumulate before committing without any boundary in sight.
 *
 * Someone speaking without pausing produces no punctuation and no silence, and
 * waiting for one would stall the feature exactly when it is needed most. Ten
 * words is roughly three seconds of speech — long enough that the cut usually
 * lands somewhere a translator can work with, short enough that the listener is
 * not left waiting on a boundary that may never arrive.
 */
export const MAX_WORDS_WITHOUT_BOUNDARY = 10;

/**
 * Shortest clause worth sending to translation on its own.
 *
 * A two-word fragment translates badly out of context and costs a full request
 * and a synthesis call to say almost nothing. The floor is waived at a silence,
 * where a short clause is a real one rather than an artifact of where the read
 * happened to stop.
 */
export const MIN_CLAUSE_WORDS = 3;

/** Clause and sentence terminators, as they appear at the end of a word. */
const TERMINATOR = /[.,;:!?…]$/;

export interface TranscriptRead {
  /** Recogniser output for this read, in the source language, unmodified. */
  text: string;
  /**
   * True when this read covers the turn from its very first sample.
   *
   * The English partial scheduler caps its window at the newest ~8s, so on a
   * long turn a read starts mid-utterance and its first word is NOT the turn's
   * first word. Getting this wrong is not a small error: aligning a windowed
   * read as if it were anchored is what produced phantom contradictions in the
   * measurement harness — the count went UP as the agreement threshold rose,
   * which cannot happen with real instability. So the caller declares it rather
   * than this module guessing.
   */
  coversTurnStart: boolean;
  /** True when the read ends at a detected pause, which is a clause boundary. */
  endsAtSilence?: boolean;
}

export interface CommitStats {
  /**
   * Words already spoken that a later read contradicted. Counted, never acted
   * on — the audio is gone. This is the number that says whether the whole
   * approach is sound.
   */
  contradictions: number;
  /**
   * Windowed reads that could not be lined up with what was already committed.
   * Skipped rather than guessed at. A rising count means the window is sliding
   * faster than the commit rate, which is a scheduling problem, not a text one.
   */
  unalignableReads: number;
  /** Words handed out for translation so far. */
  committedWords: number;
}

interface AlignedRead {
  words: string[];
  /** Normalized tokens produced by each word, in order. */
  tokensPerWord: number[];
  tokens: string[];
}

function alignRead(text: string, language: NormalizerLanguage): AlignedRead {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokensPerWord: number[] = [];
  const tokens: string[] = [];
  for (const word of words) {
    const wordTokens = normalizeForComparison(word, language);
    tokensPerWord.push(wordTokens.length);
    tokens.push(...wordTokens);
  }
  return { words, tokensPerWord, tokens };
}

/**
 * Largest overlap between the tail of `committed` and the head of `tokens`.
 *
 * How a windowed read is anchored: the read begins somewhere inside text we have
 * already committed, and this finds where. Returns 0 when nothing lines up,
 * which the caller treats as "cannot place this read" rather than "the read
 * starts at the beginning".
 */
function tailOverlap(committed: string[], tokens: string[]): number {
  const max = Math.min(committed.length, tokens.length);
  for (let size = max; size > 0; size -= 1) {
    let matches = true;
    for (let i = 0; i < size; i += 1) {
      if (committed[committed.length - size + i] !== tokens[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }
  return 0;
}

export class StablePrefixCommitter {
  private readonly language: NormalizerLanguage;
  private readonly agreementDepth: number;
  private readonly maxWordsWithoutBoundary: number;
  private readonly minClauseWords: number;

  /** Normalized tokens already spoken. Only ever grows. */
  private committedTokens: string[] = [];
  /** Absolute token sequences of the most recent reads, for agreement. */
  private history: string[][] = [];
  private stats: CommitStats = {
    contradictions: 0,
    unalignableReads: 0,
    committedWords: 0,
  };

  constructor(options: {
    language: NormalizerLanguage;
    agreementDepth?: number;
    maxWordsWithoutBoundary?: number;
    minClauseWords?: number;
  }) {
    this.language = options.language;
    this.agreementDepth =
      options.agreementDepth ??
      (options.language === 'en' ? AGREEMENT_DEPTH_EN : AGREEMENT_DEPTH_VI);
    this.maxWordsWithoutBoundary =
      options.maxWordsWithoutBoundary ?? MAX_WORDS_WITHOUT_BOUNDARY;
    this.minClauseWords = options.minClauseWords ?? MIN_CLAUSE_WORDS;
  }

  getStats(): CommitStats {
    return { ...this.stats };
  }

  /**
   * Feed one read; get back the text that is now safe to speak.
   *
   * Returns '' when nothing new qualifies, which is the common answer and not an
   * error.
   */
  observe(read: TranscriptRead): string {
    const aligned = alignRead(read.text, this.language);
    if (aligned.tokens.length === 0) return '';

    // Where this read's first token sits in the turn's absolute token stream.
    let base: number;
    if (read.coversTurnStart) {
      base = 0;
    } else {
      const overlap = tailOverlap(this.committedTokens, aligned.tokens);
      if (overlap === 0 && this.committedTokens.length > 0) {
        this.stats.unalignableReads += 1;
        return '';
      }
      base = this.committedTokens.length - overlap;
    }

    const absolute = [
      ...this.committedTokens.slice(0, base),
      ...aligned.tokens,
    ];

    const supported = commonPrefixLength(this.committedTokens, absolute);
    if (supported < this.committedTokens.length) {
      this.stats.contradictions += this.committedTokens.length - supported;
    }

    this.history.push(absolute);
    if (this.history.length > this.agreementDepth) this.history.shift();

    const stable = this.stableTokenCount();
    // Forward only. A read that shrinks the agreed prefix does not un-say
    // anything; it just fails to extend it.
    const target = Math.max(stable, this.committedTokens.length);
    return this.commitUpTo(aligned, base, target, read.endsAtSilence === true);
  }

  /**
   * Commit whatever is left at the end of a turn.
   *
   * The turn is over, so there is no later read to contradict anything and no
   * boundary left to wait for: the remainder of the last read is spoken as is.
   */
  finalize(read: TranscriptRead): string {
    const aligned = alignRead(read.text, this.language);
    if (aligned.tokens.length === 0) return '';
    const base = read.coversTurnStart
      ? 0
      : this.committedTokens.length -
        tailOverlap(this.committedTokens, aligned.tokens);
    const absolute = [
      ...this.committedTokens.slice(0, base),
      ...aligned.tokens,
    ];
    return this.commitUpTo(aligned, base, absolute.length, true);
  }

  /** Longest prefix every read in the window agrees on. */
  private stableTokenCount(): number {
    if (this.history.length < this.agreementDepth) return 0;
    const [first, ...rest] = this.history;
    if (first === undefined) return 0;
    let stable = first.length;
    let previous = first;
    for (const read of rest) {
      stable = Math.min(stable, commonPrefixLength(previous, read));
      previous = read;
    }
    return stable;
  }

  /**
   * Emit the words between what is already committed and the last usable clause
   * boundary at or before `targetTokens`.
   */
  private commitUpTo(
    aligned: AlignedRead,
    base: number,
    targetTokens: number,
    atSilence: boolean,
  ): string {
    const localStart = this.committedTokens.length - base;
    const localTarget = targetTokens - base;
    if (localTarget <= localStart) return '';

    // Walk the words, tracking the token cursor, and record the LAST clause
    // boundary inside the stable region — not the first.
    //
    // Committing every settled clause at once rather than one per read is
    // deliberate. It costs no latency, because everything released is already
    // stable, and the synthesizer splits it back into clauses anyway; what it
    // saves is one translation request per clause, on a free tier metered per
    // minute. Holding settled text back would only make the speaker wait for the
    // next read to say something we already knew was safe.
    let cursor = 0;
    let startWord = -1;
    let boundaryWord = -1;
    let forcedBoundaryWord = -1;
    let wordsSinceCommit = 0;

    for (const [w, word] of aligned.words.entries()) {
      const wordEnd = cursor + (aligned.tokensPerWord[w] ?? 0);
      if (cursor >= localStart && startWord === -1) startWord = w;
      if (startWord !== -1) {
        wordsSinceCommit += 1;
        if (wordEnd > localTarget) break;
        const isLastWord = w === aligned.words.length - 1;
        const endsClause = TERMINATOR.test(word) || (atSilence && isLastWord);
        const longEnough = wordsSinceCommit >= this.minClauseWords || atSilence;
        if (endsClause && longEnough) boundaryWord = w;
        // The forced cut fires at exactly the threshold, once. Letting it hold
        // past that would make it the last boundary on every long stretch and
        // silently override the clause rule.
        if (
          forcedBoundaryWord === -1 &&
          wordsSinceCommit === this.maxWordsWithoutBoundary
        ) {
          forcedBoundaryWord = w;
        }
      }
      cursor = wordEnd;
    }

    // A real clause boundary always beats the word-count fallback; the fallback
    // only exists for speech that offers no boundary at all.
    if (boundaryWord === -1) boundaryWord = forcedBoundaryWord;
    if (startWord === -1 || boundaryWord === -1) return '';

    const words = aligned.words.slice(startWord, boundaryWord + 1);
    const committedTokens = aligned.tokensPerWord
      .slice(startWord, boundaryWord + 1)
      .reduce((sum, count) => sum + count, 0);
    this.committedTokens = [
      ...this.committedTokens,
      ...aligned.tokens.slice(localStart, localStart + committedTokens),
    ];
    this.stats.committedWords += words.length;
    return words.join(' ');
  }
}

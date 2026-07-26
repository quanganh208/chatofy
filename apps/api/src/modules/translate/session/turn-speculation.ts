import type { TranslatedTurnText } from '../services/pipeline-translator.service';
import { MAX_SPECULATIONS_PER_TURN } from './translation-model-policy';

/**
 * Transcription and translation started on a suspected end of speech, before
 * the endpoint was confirmed.
 */
interface Guess {
  /** Bytes buffered when it started; if the turn grew, the work is stale. */
  atBytes: number;
  work: Promise<TranslatedTurnText>;
}

/**
 * One turn's guessing: what has been guessed, how much it has cost, and whether
 * the guess in hand can still be used.
 *
 * Separate from the turn's audio and phase because everything here is a spend
 * decision against a metered API, and mixing it with the buffer is how the
 * question "is this guess still valid" gets answered by the wrong number.
 */
export class TurnSpeculation {
  /** The most recent guess; earlier ones are superseded and dropped. */
  private current: Guess | null = null;
  /** How many guesses this turn has spent, against the cap. */
  private spent = 0;

  get count(): number {
    return this.spent;
  }

  /** Whether another guess over `bufferedBytes` of audio is worth making. */
  canRenew(bufferedBytes: number): boolean {
    // Nothing new to transcribe: a second guess over identical audio would buy
    // an identical answer for another request.
    if (this.current?.atBytes === bufferedBytes) return false;
    // A client that suspects the end constantly must not be able to spend the
    // quota of one that talks normally.
    return this.spent < MAX_SPECULATIONS_PER_TURN;
  }

  start(atBytes: number, work: Promise<TranslatedTurnText>): void {
    // A speculation the endpoint never confirms is thrown away unawaited, and
    // an unobserved rejection would take the process down. This matters more
    // now than it did: every guess but the last is discarded by design.
    //
    // Attached here rather than left to the caller: the cost of forgetting it
    // is the whole process, and this way there is nothing to forget.
    work.catch(() => undefined);

    // The superseded guess is dropped rather than cancelled — the pipeline has
    // no cancellation, so its cost is already spent either way.
    this.current = { atBytes, work };
    this.spent += 1;
  }

  /** The guess the endpoint may still reuse, if there is one. */
  usable(bufferedBytes: number): Promise<TranslatedTurnText> | null {
    // A speculation is only usable if no further audio arrived after it
    // started — otherwise it transcribed a different utterance to the one
    // being ended.
    if (!this.current) return null;
    if (this.current.atBytes !== bufferedBytes) return null;
    return this.current.work;
  }
}

import { splitIntoClauses } from './clause-splitter';
import type { TranslationBudget } from './translation-budget';

/**
 * Decides when a sentence still being spoken is worth translating early.
 *
 * Every yes here is a metered request against a per-minute ceiling this system
 * has already been measured bumping into, and when that ceiling is hit the
 * request that suffers is the one the speaker is actually waiting for. So the
 * gate stays; what changed is what opens it.
 *
 * It used to open on the CLOCK: a turn had to be three seconds old, then a
 * couple of seconds had to pass between guesses, then the turn ran out of
 * guesses entirely. A 2.5-second sentence — the commonest kind — got no
 * mid-sentence translation at all, and a long one got three updates however
 * much was said. The delay people complained about was those constants, not the
 * recogniser.
 *
 * It now opens on PROGRESS: enough newly settled characters, a newly closed
 * clause, or a correction that replaced text already on screen. The input is
 * settled text rather than the raw reading, because the raw reading still moves
 * — translating it means paying for words that are about to change.
 *
 * ONE STRING IN, used for the decision, the bookkeeping and the payload alike.
 * An earlier design moved only the decision onto settled text and left the
 * bookkeeping reading the full hypothesis; the two units drifted apart on the
 * first fire, and the character rule — the only rule that works for Vietnamese —
 * was dead from then on.
 *
 * There is deliberately no minimum interval. `inFlight` is already a natural
 * ceiling: nothing fires again until Gemini answers, measured at a 723ms median,
 * so one speaker cannot exceed roughly 83 requests a minute however small the
 * character threshold is. At a 300ms read cadence and a 15-character threshold
 * the character rule binds first, near 56. A re-added interval would not be
 * protecting anything.
 */

export interface LiveTranslationTriggerOptions {
  /** Shared ceiling this turn spends against. */
  budget: TranslationBudget;
  /** Newly settled characters that justify another translation. */
  commitChars: number;
  /** Who is spending, for the per-user tier. */
  userId: string;
  /** Which model is being spent, since quota is metered per model. */
  model: string;
}

export class LiveTranslationTrigger {
  private readonly budget: TranslationBudget;
  private readonly commitChars: number;
  private readonly userId: string;
  private readonly model: string;

  private inFlight = false;
  private spent = 0;
  private lastCommittedLength = 0;
  private lastClauseCount = 0;
  private lastReanchors = 0;

  constructor(options: LiveTranslationTriggerOptions) {
    this.budget = options.budget;
    this.commitChars = options.commitChars;
    this.userId = options.userId;
    this.model = options.model;
  }

  /**
   * Whether the settled text so far is worth translating now.
   *
   * `committed` is the part of the transcript that has stopped being revised;
   * `reanchors` is how many times it has been REPLACED rather than extended.
   *
   * The character rule is deliberately first, and it is not a fallback. The
   * Vietnamese recogniser emits no punctuation at all — the model's own notes
   * record output like "XIN CHÀO HÔM NAY TRỜI RẤT ĐẸP", and post-processing only
   * lowercases it. `splitIntoClauses` matches on `,;:.!?…`, so on Vietnamese it
   * never matches and the clause rule never fires. For `vi_to_en`, the main
   * direction, counting characters is the only mechanism there is. English from
   * Moonshine does carry punctuation, so `en_to_vi` gets both.
   */
  shouldTranslate(committed: string, reanchors: number): boolean {
    if (this.inFlight) return false;
    if (!this.budget.canSpend(this.userId, this.model)) return false;
    if (!committed.trim()) return false;

    if (committed.length - this.lastCommittedLength >= this.commitChars)
      return true;
    if (clauseCount(committed) > this.lastClauseCount) return true;
    // A correction is worth a request of its own, because a re-anchor can leave
    // settled text SHORTER than it was — and then the character rule goes
    // negative and stays quiet while the screen holds a translation of a
    // sentence that has since been taken back.
    //
    // A transition, not a state: compared as a state it would be true forever
    // after the first correction, which is the trap the clause rule documents.
    return reanchors > this.lastReanchors;
  }

  /**
   * Records that a translation of `committed` has been sent.
   *
   * Assigns rather than accumulates, so a re-anchor that shortened the settled
   * text moves the baseline down with it instead of leaving an unreachable mark.
   */
  markStarted(committed: string, reanchors: number): void {
    this.inFlight = true;
    this.spent += 1;
    this.lastCommittedLength = committed.length;
    this.lastClauseCount = clauseCount(committed);
    this.lastReanchors = reanchors;
    this.budget.spend(this.userId, this.model);
  }

  markSettled(): void {
    this.inFlight = false;
  }

  /**
   * Requests this turn has spent, so the cost can be recorded, not inferred.
   *
   * Kept even though the budget counts process-wide spend too: `turn-timeline`
   * reads this to fill the `liveTranslations` column, and a per-turn count and a
   * per-minute bucket answer different questions.
   */
  get spentCount(): number {
    return this.spent;
  }

  /**
   * The model this turn's mid-sentence translations are metered against.
   *
   * Exposed so the turn's metrics can ask about the same bucket the budget
   * spends from. Quota is per project per model, so a cooldown count taken on
   * any other model would be describing a different ceiling.
   */
  get meteredModel(): string {
    return this.model;
  }
}

/**
 * CLOSED clauses in a piece of text, using the splitter the speech path uses.
 *
 * Closed is the load-bearing word. `splitIntoClauses` returns one part for text
 * with no boundary in it at all, so counting its parts would report a clause for
 * every non-empty string — the rule would fire on the first read of any turn and
 * the character threshold would never get to decide anything. The final part is
 * only a finished clause when the text actually ends on a boundary mark.
 */
function clauseCount(text: string): number {
  const parts = splitIntoClauses(text);
  if (parts.length === 0) return 0;
  return CLOSING_MARK.test(text.trimEnd()) ? parts.length : parts.length - 1;
}

/** The boundary marks `clause-splitter` splits on, anchored at the end. */
const CLOSING_MARK = /[,;:.!?…]$/;

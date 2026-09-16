/**
 * Decides whether a mid-sentence translation may be sent, BEFORE it is sent.
 *
 * The provider already reacts to a rate limit after the fact: it rotates keys
 * and cools the (key, model) pair that answered 429. That machinery is measured
 * and stays. What it cannot do is prevent the request, and a turn that spends
 * its way into a cooldown has already made the next speaker wait — the repo has
 * the measurement, seven rate limits over thirty-two turns with one answer
 * arriving fifteen seconds late. The totals barely moved; the bunching is what
 * hurt.
 *
 * Two tiers, because one is not a limit. A single global bucket lets one person
 * talking continuously lock everyone else out, and a purely per-user one lets
 * enough people together sail past a ceiling that belongs to the whole process.
 * `turn-concurrency.ts` reaches the same conclusion for a different resource and
 * says so at length; `live-session-limits.ts` puts it in one line — a limit each
 * path could exhaust independently is not a limit.
 *
 * Deliberately absent, and not to be added back:
 *
 * - **A penalty on 429.** The provider owns that response, per key and per
 *   model, with cooldowns it has measured. A second penalty here would act on a
 *   different key than the one that failed, since it cannot see which key was
 *   used, and it would punish one event twice.
 * - **A daily counter.** The 500-per-day-per-model allowance is real, but a
 *   counter in memory loses its count on restart and keys its "day" to this
 *   machine's clock rather than to Google's reset. It would report safe while
 *   unsafe, which is worse than not checking at all. Daily spend is measured at
 *   acceptance instead.
 * - **A reservation for the end-of-turn translation.** There is nothing to
 *   reserve with: the live lane and the final lane draw on the SAME model, so
 *   the only way to leave room is to set this ceiling below the real one, which
 *   is exactly what the configured default does.
 */

/** The window every ceiling here is expressed over. */
const WINDOW_MS = 60_000;

/**
 * Separates the two halves of a per-user key.
 *
 * Model ids are lowercase and dotted, user ids are cuids — neither can contain
 * this, so no pair of distinct inputs can collide on one key.
 */
const KEY_SEPARATOR = '::';

/**
 * Map size that triggers a full sweep for stale keys.
 *
 * Above the number of people who could plausibly be mid-conversation at once,
 * so a sweep means the map is holding people who have already left rather than
 * people who are still talking.
 */
const SWEEP_ABOVE = 64;

export interface TranslationBudgetOptions {
  /** Ceiling for any one user, on one model, per minute. */
  perUserRpm: number;
  /**
   * Ceiling for the whole process, on one model, per minute.
   *
   * Defaults to `perUserRpm`, which is the conservative reading: with a single
   * account in play the two tiers describe the same ceiling, and several users
   * then share it rather than adding to it. Raise it explicitly once the quota
   * headroom is known. It must never exceed what the key pool actually affords,
   * because going over is not refused here — it is refused by Google.
   */
  globalRpm?: number;
  now?: () => number;
}

export class TranslationBudget {
  private readonly perUserRpm: number;
  private readonly globalRpm: number;
  private readonly now: () => number;
  private readonly perUser = new Map<string, number[]>();
  private readonly perModel = new Map<string, number[]>();

  constructor(options: TranslationBudgetOptions) {
    // Refusing is a legitimate answer from this class, which is exactly why a
    // nonsense ceiling has to fail here instead. A budget built with `undefined`
    // or `0` says no to everything and looks like quota exhaustion while it does
    // it — a misconfiguration that presents as correct behaviour.
    if (!Number.isFinite(options.perUserRpm) || options.perUserRpm <= 0) {
      throw new TypeError(
        `TranslationBudget needs a positive per-user ceiling, got ${String(options.perUserRpm)}`,
      );
    }
    this.perUserRpm = options.perUserRpm;
    // Never below the per-user tier: a global ceiling under it would make the
    // per-user number a lie, since one user could never reach their own limit.
    this.globalRpm = Math.max(
      options.globalRpm ?? options.perUserRpm,
      options.perUserRpm,
    );
    this.now = options.now ?? Date.now;
  }

  /** Whether one more mid-sentence request fits. Does NOT spend. */
  canSpend(userId: string, model: string): boolean {
    return (
      this.recent(this.perUser, userKey(userId, model)).length <
        this.perUserRpm &&
      this.recent(this.perModel, model).length < this.globalRpm
    );
  }

  /** Records one request against both tiers. */
  spend(userId: string, model: string): void {
    const at = this.now();
    this.append(this.perUser, userKey(userId, model), at);
    this.append(this.perModel, model, at);
  }

  /**
   * Prunes, records, and puts the list back.
   *
   * The put-back is not redundant: `recent` drops a key whose window has emptied,
   * so the list it hands back for a quiet key is no longer the one in the map.
   * Pushing onto that list alone would lose the spend.
   */
  private append(store: Map<string, number[]>, key: string, at: number): void {
    const kept = this.recent(store, key);
    kept.push(at);
    store.set(key, kept);
    if (store.size > SWEEP_ABOVE) this.sweep(store);
  }

  /**
   * Drops every key whose window has emptied.
   *
   * Pruning on read alone is not enough, and the gap is specifically the user
   * who stops speaking: nothing ever reads their key again, so their entry
   * outlives them. This runs only once the map has grown past a size a real
   * conversation never reaches, so the common path pays nothing for it.
   */
  private sweep(store: Map<string, number[]>): void {
    const cutoff = this.now() - WINDOW_MS;
    for (const [key, timestamps] of store) {
      if (timestamps.every((at) => at <= cutoff)) store.delete(key);
    }
  }

  /** How many requests this model has taken in the last minute, process-wide. */
  spentLastMinute(model: string): number {
    return this.recent(this.perModel, model).length;
  }

  /**
   * A key's live timestamps, with anything older than the window dropped.
   *
   * Pruned on read rather than on a timer, so there is nothing to shut down, and
   * the key is dropped once it empties — otherwise the map gains an entry for
   * every user who has ever spoken and never loses one.
   */
  private recent(store: Map<string, number[]>, key: string): number[] {
    const cutoff = this.now() - WINDOW_MS;
    const kept = (store.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) store.delete(key);
    else store.set(key, kept);
    return kept;
  }
}

/**
 * Keyed by model as well as by user, because Google meters per project per
 * model. A bucket blind to the model would charge traffic on two different
 * models against one ceiling and refuse requests that had quota waiting.
 */
const userKey = (userId: string, model: string): string =>
  `${model}${KEY_SEPARATOR}${userId}`;

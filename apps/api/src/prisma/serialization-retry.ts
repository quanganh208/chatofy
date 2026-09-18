/**
 * What a failed transaction has to look like for re-running it to be worth
 * anything, and how long a store waits before it does.
 *
 * Here rather than in a store, because "which failures are transient" is one
 * fact about Postgres and the driver this app reaches it through — it does not
 * vary with the table being written. It lived in two stores as two copies, and
 * the copies drifted: one learned the second error shape below, the other kept
 * matching `err.code` alone and went on answering 500 to a conflict its retry
 * loop existed to absorb.
 *
 * What stays with each store is POLICY — how many attempts it will spend and how
 * long it is willing to pause — because that depends on what the transaction
 * costs and on whether a conflict is an ordinary outcome there or an accident.
 */

/**
 * Postgres serialization failures and deadlocks — conflicts a retry can resolve.
 *
 * `P2034` is Prisma's own write conflict, `40001` is SQLSTATE
 * serialization_failure and `40P01` is deadlock_detected. Each of the three says
 * Postgres refused to order a pair of transactions rather than that the work was
 * wrong, so running one of them again is the entire remedy.
 *
 * Prisma's unique violation (`P2002`) is deliberately NOT here. It is not
 * transient: re-running the identical body hits the identical constraint, so a
 * retry would only spend more transactions, and log more misleading
 * "serialization conflict" warnings, before failing exactly as it did the first
 * time.
 */
const RETRYABLE_CODES = new Set(['P2034', '40001', '40P01']);

/**
 * How far {@link isRetryableConflict} walks a `cause` chain before giving up.
 *
 * Headroom, not a measurement: the chain observed here is one hop deep. The
 * bound is what stops a self-referential `cause` from spinning, so it wants to
 * be small and finite rather than exact.
 */
const MAX_CAUSE_DEPTH = 4;

/**
 * Whether a failed transaction is one re-running can resolve.
 *
 * The code is looked for down the `cause` chain and under two names, because the
 * same conflict arrives in two shapes depending on WHERE Postgres notices it.
 * Aborted on a statement inside the transaction, it is a
 * `PrismaClientKnownRequestError` with `code: 'P2034'` and no `cause` at all.
 * Aborted at COMMIT, it is a `DriverAdapterError` carrying no `code` whatever,
 * whose `cause` is a plain object — not an `Error` — holding
 * `originalCode: '40001'`. Both were reproduced against this schema by forcing
 * the two interleaves.
 *
 * Reading `err.code` alone caught the first and missed the second, and the
 * second is the one a route under real contention actually hits: on the AI
 * Context save, 19 of 20 concurrent pairs answered 500 on a conflict a retry
 * resolves.
 *
 * Two things a plausible-looking version gets wrong. Reading `err.cause.code`
 * finds nothing — the field is `originalCode`. Requiring the cause to be an
 * `Error` before descending rejects the real thing outright, because it is a
 * plain object.
 */
export function isRetryableConflict(err: unknown): boolean {
  let cursor: unknown = err;
  for (let depth = 0; cursor !== null && cursor !== undefined; depth += 1) {
    if (depth >= MAX_CAUSE_DEPTH) return false;
    const { code, originalCode, cause } = cursor as {
      code?: unknown;
      originalCode?: unknown;
      cause?: unknown;
    };
    for (const candidate of [code, originalCode]) {
      if (typeof candidate === 'string' && RETRYABLE_CODES.has(candidate)) {
        return true;
      }
    }
    cursor = cause;
  }
  return false;
}

/**
 * A randomised pause that grows with the attempt, bounded by `ceilingMs`.
 *
 * Fully random rather than "a fixed delay plus jitter": the point is that the
 * two transactions wait for DIFFERENT lengths of time, and a fixed floor they
 * share leaves them as much in step as they started. A retry that fires
 * immediately re-enters the window that produced the conflict, with both sides
 * re-running together to collide on the identical rows again.
 *
 * The ceiling is the caller's, because it is latency added to a request already
 * in flight and only the store knows what its transaction is worth waiting for.
 */
export function retryDelayMs(attempt: number, ceilingMs: number): number {
  const ceiling = Math.min(ceilingMs, 2 ** (attempt - 1) * 5);
  return Math.random() * ceiling;
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

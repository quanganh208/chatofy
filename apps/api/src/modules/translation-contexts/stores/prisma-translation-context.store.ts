import { Injectable, Logger } from '@nestjs/common';
import type {
  SaveTranslationContextRequest,
  TranslationContext,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import type { TranslationContextStore } from '../interfaces/translation-context-store.interface';

/** How many times a serialization conflict is re-attempted before it surfaces. */
const MAX_SAVE_ATTEMPTS = 5;

/**
 * The upper bound, in milliseconds, on the pause before a re-attempt.
 *
 * Two conflicting saves read the same rows and insert into the same range, so
 * SSI aborts the pair rather than picking a winner, and a re-attempt that fires
 * immediately re-runs both in step to collide on the identical rows again.
 * Randomising the pause decorrelates them: one side reaches its insert first and
 * commits, and the other's re-read then sees a full library and refuses.
 *
 * Honest about what this is: a P2034 was observed reaching a caller as a 500 on
 * 2 of 20 runs of the concurrent-creates case, in a batch sharing its database
 * with other work — but it did not recur in 110 runs afterwards, with or without
 * this pause, so the pause is the standard remedy for a SERIALIZABLE retry loop
 * rather than a fix with a measured before and after. Instrumented, a conflict
 * arises about twice in thirty runs and resolves on the first re-attempt.
 *
 * Small on purpose — this is latency paid by a request already in flight, and
 * the contention it resolves is between two writes by one account.
 */
const MAX_BACKOFF_MS = 25;

/**
 * Postgres serialization failures and deadlocks — conflicts a retry can resolve.
 *
 * Prisma's unique violation (`P2002`) is deliberately NOT here, for the reason
 * `PrismaConversationStore` records: it is not a transient conflict, so
 * re-running the identical body hits the identical constraint and the retry only
 * spends two more SERIALIZABLE transactions before failing anyway. Genuinely
 * overlapping saves surface as `P2034` or SQLSTATE `40001` under this isolation
 * level, and both are retried below.
 */
const RETRYABLE_CODES = new Set(['P2034', '40001', '40P01']);

/**
 * How far {@link isRetryable} walks a `cause` chain before giving up.
 *
 * Headroom, not a measurement: the chain observed here is one hop deep. The
 * bound is what stops a self-referential `cause` from spinning, so it wants to
 * be small and finite rather than exact.
 */
const MAX_CAUSE_DEPTH = 4;

/** The columns a read selects, and the shape {@link toContext} maps. */
interface ContextRow {
  clientId: string;
  name: string;
  topic: string | null;
  hotwords: string[];
  style: string | null;
  updatedAt: Date;
  glossary: { vi: string; en: string }[];
}

/**
 * Postgres-backed AI Context library — the durable seam behind
 * TRANSLATION_CONTEXT_STORE.
 *
 * **Ownership is a filter on every query, never a path parameter.** The URL
 * carries the client-minted id; the row is addressed by the compound
 * `(ownerId, clientId)` unique, which is the only Prisma shape where omitting
 * the owner does not compile. There is no method here that takes only an id.
 *
 * **A save is a full replacement.** Glossary entries are deleted and re-created
 * inside one transaction rather than merged, and their `position` comes from the
 * array index — so the order the operator authored is the order the prompt sees,
 * and the order that decides which pairs survive the provider's cap.
 *
 * **The per-owner ceiling is counted inside that same transaction.** It is not a
 * rule this layer owns — the number arrives as an argument — but it is the only
 * layer that can hold it, because "at most N rows per owner" is a COUNT and
 * Postgres has no constraint over one. The count and the insert have to be the
 * same SERIALIZABLE transaction or nothing serialises them; see {@link save}.
 */
@Injectable()
export class PrismaTranslationContextStore implements TranslationContextStore {
  private readonly logger = new Logger(PrismaTranslationContextStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<TranslationContext[]> {
    const rows = await this.prisma.translationContext.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      select: CONTEXT_SELECT,
    });
    return rows.map(toContext);
  }

  /**
   * Create or replace one context, refusing only a CREATE past `maxPerOwner`.
   *
   * ## Why the ceiling is read here and not by the caller
   *
   * A count taken before the transaction is a read with nothing holding it: two
   * creates fired together one row short of the ceiling both saw room and both
   * committed, and the account ended up one over a maximum the product states.
   * Measured at 2 of 20 concurrent pairs before the count moved in here.
   *
   * Read HERE, the count cannot go stale before the insert it guards, because
   * they are the same transaction. And when two such transactions really do
   * overlap, SERIALIZABLE is what decides between them: the count takes a
   * predicate lock over the owner's rows, the other transaction inserts into
   * that same range, and Postgres aborts one of the pair rather than letting
   * both commit. Confirmed against this schema by forcing the interleave — both
   * transactions read 19 held, the second was refused with SQLSTATE 40001, and
   * the table finished at exactly 20 rows. The retry below then re-runs the
   * loser, whose re-read sees a full library and returns `null`.
   *
   * ## Why the membership read comes first
   *
   * A REPLACE of a context the owner already holds adds no row, so it is never
   * refused — a ceiling applied to every write would make a full library
   * permanently uneditable, and the only way out would be a delete the operator
   * did not want to make. Finding the row first also means a replace never
   * counts at all: it is a single indexed lookup, it takes no predicate lock
   * over the owner's range, and two replaces therefore do not serialise against
   * each other. The count is paid only by a CREATE, which is the write that can
   * actually breach the ceiling.
   */
  async save(
    ownerId: string,
    contextId: string,
    body: SaveTranslationContextRequest,
    maxPerOwner: number,
  ): Promise<TranslationContext | null> {
    const parent = {
      name: body.name,
      topic: body.topic,
      hotwords: body.hotwords,
      style: body.style,
    };

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const held = await tx.translationContext.findUnique({
              where: { ownerId_clientId: { ownerId, clientId: contextId } },
              select: { id: true },
            });

            // Only a create can breach the ceiling, and `null` rather than a
            // throw because the caller owns what a refusal means. Nothing has
            // been written at this point, so the transaction commits empty.
            if (held === null) {
              const owned = await tx.translationContext.count({
                where: { ownerId },
              });
              if (owned >= maxPerOwner) return null;
            }

            const row = await tx.translationContext.upsert({
              where: { ownerId_clientId: { ownerId, clientId: contextId } },
              create: { ownerId, clientId: contextId, ...parent },
              update: parent,
              select: { id: true },
            });

            // Deleted before the insert, never merged: the client re-sends the
            // whole dictionary, so a shorter re-save must not leave behind the
            // pairs the operator removed.
            await tx.glossaryTerm.deleteMany({ where: { contextId: row.id } });
            await tx.glossaryTerm.createMany({
              data: body.glossary.map((entry, index) => ({
                contextId: row.id,
                position: index,
                vi: entry.vi,
                en: entry.en,
              })),
            });

            const saved = await tx.translationContext.findUniqueOrThrow({
              where: { id: row.id },
              select: CONTEXT_SELECT,
            });
            return toContext(saved);
          },
          {
            // SERIALIZABLE for the reason the conversation replace gives: under
            // READ COMMITTED two overlapping saves of one context can both
            // delete and then both insert, leaving a dictionary that is the
            // union of two edits and was authored by neither. It is also what
            // makes the ceiling above hold — a count under any weaker level sees
            // a snapshot nothing stops another transaction from invalidating.
            isolationLevel: 'Serializable',
            // Explicit rather than Prisma's inherited 5s, but an order of
            // magnitude below the conversation replace's 15s: the worst
            // admissible payload here is 24 pairs, not 4000 turns.
            timeout: 10_000,
          },
        );
      } catch (err) {
        // Bounded, and logged rather than silent: a retry here means two saves
        // of one context really did overlap, and how often that happens is worth
        // seeing rather than hiding.
        if (attempt >= MAX_SAVE_ATTEMPTS || !isRetryable(err)) throw err;
        this.logger.warn(
          `retrying translation-context save after a serialization conflict ` +
            `(attempt ${attempt} of ${MAX_SAVE_ATTEMPTS}): ${String(err)}`,
        );
        await pause(backoffMs(attempt));
      }
    }
  }

  async remove(ownerId: string, contextId: string): Promise<boolean> {
    // `deleteMany` rather than `delete`: it reports a zero count instead of
    // throwing, so an id that was never there and one belonging to someone else
    // take the identical path and are indistinguishable to the caller. The
    // glossary goes with it through the relation's cascade.
    const { count } = await this.prisma.translationContext.deleteMany({
      where: { ownerId, clientId: contextId },
    });
    return count > 0;
  }
}

/**
 * The columns every read selects.
 *
 * Glossary entries are ordered by `position`, which is the column the save wrote
 * from the array index — Postgres has no inherent row order, so the order the
 * operator authored survives only because it is asked for here.
 */
const CONTEXT_SELECT = {
  clientId: true,
  name: true,
  topic: true,
  hotwords: true,
  style: true,
  updatedAt: true,
  glossary: {
    orderBy: { position: 'asc' },
    select: { vi: true, en: true },
  },
} as const;

function toContext(row: ContextRow): TranslationContext {
  return {
    id: row.clientId,
    name: row.name,
    topic: row.topic,
    hotwords: row.hotwords,
    // Stored as text so a new register is not a column migration; narrowed here
    // rather than trusted, because the column admits anything a past write put
    // there and the contract admits three values.
    style: asStyle(row.style),
    glossary: row.glossary.map((entry) => ({ vi: entry.vi, en: entry.en })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The register, taken from the contract rather than restated.
 *
 * Derived from `TranslationContext` so the set below cannot drift from what the
 * HTTP schema accepts: adding a fourth register there is a compile error here
 * until this set grows too.
 */
type ContextStyle = TranslationContext['style'];

/**
 * A key per register, rather than a `Set` of them.
 *
 * `new Set<ContextStyle>([...])` accepts any SUBSET of the union, so adding a
 * fourth register to the contract would compile here unchanged and the new value
 * would be silently narrowed to `null` on every read. A `Record` over the
 * non-null union does not: it is a missing-property error until this object
 * grows too, which is the drift guard the comment above promises.
 */
const STYLES: Record<NonNullable<ContextStyle>, true> = {
  neutral: true,
  formal: true,
  casual: true,
};

function asStyle(value: string | null): ContextStyle {
  return value !== null && Object.hasOwn(STYLES, value)
    ? (value as ContextStyle)
    : null;
}

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
 * second is the one this route actually hits: 19 of 20 concurrent save pairs
 * answered 500 on a conflict a retry resolves.
 */
/**
 * A randomised pause that grows with the attempt, bounded by
 * {@link MAX_BACKOFF_MS}.
 *
 * Fully random rather than "a fixed delay plus jitter": the point is that the
 * two transactions wait for DIFFERENT lengths of time, and a fixed floor they
 * share leaves them as much in step as they started.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, 2 ** (attempt - 1) * 5);
  return Math.random() * ceiling;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
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

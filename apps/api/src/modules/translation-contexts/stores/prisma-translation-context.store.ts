import { Injectable, Logger } from '@nestjs/common';
import type {
  SaveTranslationContextRequest,
  TranslationContext,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isRetryableConflict,
  pause,
  retryDelayMs,
} from '../../../prisma/serialization-retry';
import type { TranslationContextStore } from '../interfaces/translation-context-store.interface';

/** How many times a transient conflict is re-attempted before it surfaces. */
const MAX_SAVE_ATTEMPTS = 5;

/**
 * Namespaces the advisory locks this store takes.
 *
 * `pg_advisory_xact_lock` has ONE key space for the whole database, so the
 * two-int form is used rather than the one-bigint form: the first int names this
 * module and the second is the owner's hash, which means no other feature's lock
 * can collide with one taken here unless it also claims this class.
 */
const OWNER_LOCK_CLASS = 8154;

/**
 * The upper bound, in milliseconds, on the pause before a re-attempt.
 *
 * Randomised rather than immediate, because two transactions that conflicted
 * once re-run in step and collide again on the identical rows if both retry at
 * the same instant.
 *
 * Nothing on the ordinary concurrent path is expected to reach this now that
 * saves for one owner wait on the lock instead of aborting each other. Counted
 * in Postgres rather than inferred: twenty concurrent create pairs in one warm
 * process cancelled 42 transactions under SERIALIZABLE and none with the lock,
 * and 960 concurrent replaces by one account cancelled about 520 per run of 240
 * and none with the lock. It is kept for a DEADLOCK, which is the one conflict a
 * single lock cannot rule out, and a retry loop with no jitter is wrong even
 * where it is rarely reached.
 *
 * Small on purpose — this is latency paid by a request already in flight.
 */
const MAX_BACKOFF_MS = 25;

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
 * **Every save takes a lock on its owner first, and the per-owner ceiling is
 * counted inside that same transaction.** The ceiling is not a rule this layer
 * owns — the number arrives as an argument — but it is the only layer that can
 * hold it, because "at most N rows per owner" is a COUNT and Postgres has no
 * constraint over one. A count is worth something only if nothing can insert
 * between it and the write it guards; see {@link save} for why that is a lock
 * and no longer an isolation level.
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
   * they are the same transaction.
   *
   * ## Why the owner is locked, and not left to SERIALIZABLE
   *
   * Two overlapping transactions still have to be decided between, and this was
   * first written to let SERIALIZABLE do it — the count takes a predicate lock
   * over the owner's rows, the sibling inserts into that range, and Postgres
   * refuses one of the pair rather than letting both commit. That works, and it
   * works by ABORTING: the refused transaction has to be re-run, and only its
   * re-read turns into the 409. An abort is then an ordinary outcome of the
   * concurrent path, and the ceiling's correctness rests on a retry budget that
   * a caller can in principle exhaust into a 500 — a worse answer than the
   * overshoot the ceiling exists to prevent.
   *
   * The lock removes that lottery rather than widening it. Taken first, it makes
   * concurrent saves for one account WAIT, and at READ COMMITTED the waiter's
   * count is a fresh read that sees the row the winner just committed — so it
   * refuses on the ordinary path, with no abort and nothing to retry. Both
   * halves were confirmed against this schema by forcing the interleave one row
   * short of the ceiling: with the lock the waiter counted 20 and refused, under
   * SERIALIZABLE the same waiter counted 19 and was cancelled with SQLSTATE
   * 40001 at its write, and with neither the two both counted 19 and the table
   * finished at 21. Both of the first two finished at exactly 20 rows.
   *
   * `pg_advisory_xact_lock` and never the session-scoped `pg_advisory_lock`:
   * Prisma hands connections back to a pool, so a session lock could be released
   * on a different connection than took it. This one is released by COMMIT or
   * ROLLBACK, on the connection that holds the transaction.
   *
   * The key is `hashtext(ownerId)`, so Postgres does the hashing and it cannot
   * drift from the id. `hashtext` is 32 bits, so two owners can collide; that
   * costs two unrelated accounts serialising their saves, which is a
   * performance question and not a correctness one, because every statement
   * below is still filtered by `ownerId` and a collision grants no access.
   *
   * ## What the lock has to cover that the isolation level used to
   *
   * SERIALIZABLE was also what stopped two overlapping saves of ONE context from
   * both deleting and then both inserting the glossary, leaving a dictionary
   * that is the union of two edits and was authored by neither. Two saves of one
   * context are two saves by one owner, so the lock excludes them outright.
   * Forcing that interleave as well: with the lock the second save waited, then
   * deleted all three of the first save's pairs and inserted its own, and the
   * stored glossary was exactly one operator's. Measured, not assumed — and the
   * same interleave at READ COMMITTED with no lock at all also stored exactly
   * one operator's, because the parent upsert takes a row lock before the
   * glossary delete can run, so that particular hazard was already narrower than
   * the old comment claimed.
   *
   * ## Why the membership read comes first
   *
   * A REPLACE of a context the owner already holds adds no row, so it is never
   * refused — a ceiling applied to every write would make a full library
   * permanently uneditable, and the only way out would be a delete the operator
   * did not want to make. Finding the row first also means a replace never
   * counts at all: it is a single indexed lookup, and the count is paid only by
   * a CREATE, which is the write that can actually breach the ceiling.
   *
   * What a replace no longer avoids is the LOCK, and measuring that is how the
   * claim this comment used to make was found to be wrong. It said two replaces
   * do not serialise, because a replace takes no predicate lock over the owner's
   * range. They did: eight replaces of eight different contexts fired together
   * by one account, four runs of thirty rounds on each design — 960 requests
   * each — had Postgres cancelling 505 to 536 transactions per run under
   * SERIALIZABLE, and 60 of the 960 exhausted the retry loop and answered 500.
   * With the lock, across the same 960, no cancellation and no 500. Waiting is
   * also cheaper than colliding: the median of those requests fell from ~54ms to
   * ~34ms and the median batch from ~77ms to ~44ms, while one replace with
   * nothing competing stayed at ~8ms on both.
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
            // FIRST, before any read this transaction acts on. Everything below
            // — the membership probe, the ceiling count, the glossary replace —
            // is only sound because no other save for this owner can run between
            // two of its statements.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OWNER_LOCK_CLASS}::int, hashtext(${ownerId}))`;

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
            // READ COMMITTED, and the lock above is what pays for it. What this
            // level buys is the one thing SERIALIZABLE cannot give a waiter:
            // every statement takes a fresh snapshot, so the count taken AFTER
            // the lock sees the row the previous holder just committed and the
            // save refuses instead of aborting. Under SERIALIZABLE that same
            // waiter reads its original snapshot, writes anyway, and is
            // cancelled — which is the retry this design is removing.
            isolationLevel: 'ReadCommitted',
            // Explicit rather than Prisma's inherited 5s, but an order of
            // magnitude below the conversation replace's 15s: the worst
            // admissible payload here is 24 pairs, not 4000 turns.
            timeout: 10_000,
          },
        );
      } catch (err) {
        // Bounded, and logged rather than silent: with the lock in place a retry
        // here is no longer the ordinary concurrent path but a deadlock, which
        // is rare enough that how often it happens is worth seeing.
        if (attempt >= MAX_SAVE_ATTEMPTS || !isRetryableConflict(err)) {
          throw err;
        }
        this.logger.warn(
          `retrying translation-context save after a transient conflict ` +
            `(attempt ${attempt} of ${MAX_SAVE_ATTEMPTS}): ${String(err)}`,
        );
        await pause(retryDelayMs(attempt, MAX_BACKOFF_MS));
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

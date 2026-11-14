import { Injectable, Logger } from '@nestjs/common';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
  type TranslationContext,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isRetryableConflict,
  pause,
  retryDelayMs,
} from '../../../prisma/serialization-retry';
import { LOCK_CLASS } from '../../../common/library-scope/advisory-lock-classes';
import {
  canEditRow,
  scopeLockKey,
  scopeWhere,
  type LibraryScope,
} from '../../../common/library-scope/library-scope';
import type { RemoveResult } from '../../../common/library-scope/library-write-results';
import type {
  ContextSaveResult,
  TranslationContextStore,
} from '../interfaces/translation-context-store.interface';
import {
  CONTEXT_SELECT,
  partitionStoredGlossary,
  toContext,
} from './translation-context-row-mapping';

/** How many times a transient conflict is re-attempted before it surfaces. */
const MAX_SAVE_ATTEMPTS = 5;

/** Module-scoped: one logger for the whole store, with no instance to hold. */
const logger = new Logger('PrismaTranslationContextStore');

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

/**
 * Postgres-backed AI Context library — the durable seam behind
 * TRANSLATION_CONTEXT_STORE.
 *
 * **Scope is a filter on every query, never a path parameter.** The URL
 * carries the client-minted id; the row is found with `findFirst` over
 * {@link scopeWhere} and written by its own `id`. A team context keeps its
 * author in `ownerId`, so a personal filter must also require `teamId: null`,
 * which `scopeWhere` adds and the `(ownerId, clientId)` unique cannot. There is
 * no method here that takes only an id.
 *
 * The advisory lock is `LOCK_CLASS.CONTEXTS`: `pg_advisory_xact_lock` has ONE
 * key space for the whole database, so the two-int form is used — the first
 * int names this resource and the second is the scope's hash, so no other
 * feature's lock can collide with one taken here unless it claims this class.
 *
 * **A save is a full replacement.** Glossary entries are deleted and re-created
 * inside one transaction rather than merged, and their `position` comes from the
 * array index — so the order the operator authored is the order the prompt sees,
 * and the order that decides which pairs survive the provider's cap.
 *
 * **Every save takes a lock on its scope first, and the per-scope ceiling is
 * counted inside that same transaction.** The ceiling is not a rule this layer
 * owns — the number arrives as an argument — but it is the only layer that can
 * hold it, because "at most N rows per owner" is a COUNT and Postgres has no
 * constraint over one. A count is worth something only if nothing can insert
 * between it and the write it guards; see {@link save} for why that is a lock
 * and no longer an isolation level.
 */
@Injectable()
export class PrismaTranslationContextStore implements TranslationContextStore {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: LibraryScope): Promise<TranslationContext[]> {
    const rows = await this.prisma.translationContext.findMany({
      where: scopeWhere(scope),
      orderBy: { updatedAt: 'desc' },
      select: CONTEXT_SELECT,
    });
    return rows.map((row) => toContext(row, scope));
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
   * ## Why the scope is locked, and not left to SERIALIZABLE
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
   * The key is `hashtext(scopeLockKey(scope))` — the user id for a personal
   * library, the team id for a team's — so Postgres does the hashing and it
   * cannot drift from the id. `hashtext` is 32 bits, so two scopes can collide;
   * that costs two unrelated libraries serialising their saves, which is a
   * performance question and not a correctness one, because every statement
   * below is still filtered by `scopeWhere` and a collision grants no access.
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
   * one operator's, because the parent write takes a row lock before the
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
    scope: LibraryScope,
    contextId: string,
    body: SaveTranslationContextRequest,
    maxPerOwner: number,
  ): Promise<ContextSaveResult> {
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
            // is only sound because no other save in this scope can run between
            // two of its statements.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CLASS.CONTEXTS}::int, hashtext(${scopeLockKey(scope)}))`;

            const held = await tx.translationContext.findFirst({
              where: { ...scopeWhere(scope), clientId: contextId },
              select: { id: true, ownerId: true },
            });

            // The author rule, before anything else is read or written: a team
            // member replaces only a context they authored. A TEAM create also
            // refuses a client id any context anywhere already uses, so a
            // member cannot plant a row under an id another scope reads.
            if (held !== null && !canEditRow(scope, held.ownerId)) {
              return { kind: 'forbidden' } as const;
            }
            if (held === null && scope.kind === 'team') {
              const taken = await tx.translationContext.findFirst({
                where: { clientId: contextId },
                select: { id: true },
              });
              if (taken !== null) return { kind: 'id-in-use' } as const;
            }

            // The request names the linked glossary by its CLIENT id, while the
            // FK column holds the glossary's server cuid, so the id is resolved
            // here rather than written through. The lookup is confined to the
            // context's own scope: a personal context links only a personal
            // glossary, a team context only one of the same team, and an id
            // from anywhere else finds nothing and is refused.
            let linkedGlossaryId: string | null = null;
            if (body.glossaryId !== null) {
              const linked = await tx.glossary.findFirst({
                where: { ...scopeWhere(scope), clientId: body.glossaryId },
                select: { id: true },
              });
              if (linked === null) return { kind: 'glossary-missing' } as const;
              linkedGlossaryId = linked.id;
            }

            // Only a create can breach the ceiling, and a result rather than a
            // throw because the caller owns what a refusal means. Nothing has
            // been written at this point, so the transaction commits empty.
            if (held === null) {
              const owned = await tx.translationContext.count({
                where: scopeWhere(scope),
              });
              if (owned >= maxPerOwner) return { kind: 'limit' } as const;
            }

            // Rows the CURRENT schema cannot read, read BEFORE the replace below
            // touches anything. `toContext`/`list` already drop a row like this
            // from what the editor can show — a stricter word-count cap landed
            // after some rows were written, or a registry language was added and
            // later rolled back — so the operator never sees it and the body
            // this save is about to write never re-sends it either. Without this,
            // the full-replace two lines down reads that silence as "the
            // operator deleted it" and does so for real. `held === null` is a
            // CREATE: there is no existing context yet, so nothing to preserve.
            // Ordered by `position`, so what survives the cap, and the order the
            // survivors are renumbered in, is the authored order and not
            // whatever order Postgres happens to return. The cap is read from
            // the contract here, unlike the per-owner ceiling the caller passes
            // in, because it is not a new decision: the request body was already
            // held to it, and only this store knows how many rows it is adding
            // on top of the body.
            const { preserved, discardedEmpty, discardedOverCap } =
              held === null
                ? { preserved: [], discardedEmpty: 0, discardedOverCap: 0 }
                : partitionStoredGlossary(
                    (
                      await tx.glossaryTerm.findMany({
                        where: { contextId: held.id },
                        orderBy: { position: 'asc' },
                        select: { terms: true },
                      })
                    ).map((entry) => entry.terms),
                    CONTEXT_LIMITS.MAX_GLOSSARY - body.glossary.length,
                  );
            // Once per save, not once per read: a save is the moment these rows
            // are either carried forward or lost, and a read that warned on
            // every fetch of the same context would bury that in repetition.
            if (preserved.length + discardedEmpty + discardedOverCap > 0) {
              logger.warn(
                `context ${contextId}: carrying ${preserved.length} unreadable ` +
                  `glossary row(s) through the replace; discarding ` +
                  `${discardedEmpty} with no term map and ${discardedOverCap} ` +
                  `past the ${CONTEXT_LIMITS.MAX_GLOSSARY}-entry cap`,
              );
            }

            // Created or updated by id, never addressed through the
            // `(ownerId, clientId)` unique, which cannot carry `teamId: null`.
            const row =
              held === null
                ? await tx.translationContext.create({
                    data: {
                      ownerId: scope.userId,
                      teamId: scope.kind === 'team' ? scope.teamId : null,
                      clientId: contextId,
                      ...parent,
                      glossaryId: linkedGlossaryId,
                    },
                    select: { id: true },
                  })
                : await tx.translationContext.update({
                    where: { id: held.id },
                    data: { ...parent, glossaryId: linkedGlossaryId },
                    select: { id: true },
                  });

            // Deleted before the insert, never merged: the client re-sends the
            // whole dictionary, so a shorter re-save must not leave behind the
            // pairs the operator removed.
            await tx.glossaryTerm.deleteMany({ where: { contextId: row.id } });
            await tx.glossaryTerm.createMany({
              data: [
                ...body.glossary.map((entry, index) => ({
                  contextId: row.id,
                  position: index,
                  // Stored as the validated map itself — `entry` already
                  // satisfies `glossaryEntrySchema`, which is what the request
                  // body was parsed against before reaching this store.
                  terms: entry,
                })),
                // Appended after the operator's own entries, never interleaved:
                // `position` is the order the operator authored, and a row
                // nobody could see to edit must not shift it. Carried through
                // byte-for-byte — re-validating would just drop it again.
                ...preserved.map((terms, index) => ({
                  contextId: row.id,
                  position: body.glossary.length + index,
                  terms,
                })),
              ],
            });

            const saved = await tx.translationContext.findUniqueOrThrow({
              where: { id: row.id },
              select: CONTEXT_SELECT,
            });
            return { kind: 'saved', value: toContext(saved, scope) } as const;
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
        logger.warn(
          `retrying translation-context save after a transient conflict ` +
            `(attempt ${attempt} of ${MAX_SAVE_ATTEMPTS}): ${String(err)}`,
        );
        await pause(retryDelayMs(attempt, MAX_BACKOFF_MS));
      }
    }
  }

  async remove(scope: LibraryScope, contextId: string): Promise<RemoveResult> {
    // The author check and the delete share one transaction, so the row
    // checked is the row deleted. `deleteMany` by id rather than `delete`: a
    // concurrent delete that won leaves a zero count, read as absent instead
    // of a throw, and an id that was never there and one belonging to another
    // scope take the identical path. Terms go with it through the cascade.
    return this.prisma.$transaction(async (tx) => {
      const held = await tx.translationContext.findFirst({
        where: { ...scopeWhere(scope), clientId: contextId },
        select: { id: true, ownerId: true },
      });
      if (held === null) return 'absent';
      if (!canEditRow(scope, held.ownerId)) return 'forbidden';
      const { count } = await tx.translationContext.deleteMany({
        where: { id: held.id },
      });
      return count > 0 ? 'removed' : 'absent';
    });
  }
}

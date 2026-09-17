import { Injectable, Logger } from '@nestjs/common';
import type {
  SaveTranslationContextRequest,
  TranslationContext,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import type { TranslationContextStore } from '../interfaces/translation-context-store.interface';

/** How many times a serialization conflict is re-attempted before it surfaces. */
const MAX_REPLACE_ATTEMPTS = 3;

/**
 * Postgres serialization failures and deadlocks — conflicts a retry can resolve.
 *
 * Prisma's unique violation (`P2002`) is deliberately NOT here, for the reason
 * `PrismaConversationStore` records: it is not a transient conflict, so
 * re-running the identical body hits the identical constraint and the retry only
 * spends two more SERIALIZABLE transactions before failing anyway. Genuinely
 * overlapping saves surface as `P2034` under this isolation level, which is
 * retried below.
 */
const RETRYABLE_CODES = new Set(['P2034', '40001', '40P01']);

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

  async count(ownerId: string): Promise<number> {
    return this.prisma.translationContext.count({ where: { ownerId } });
  }

  async save(
    ownerId: string,
    contextId: string,
    body: SaveTranslationContextRequest,
  ): Promise<TranslationContext> {
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
            // union of two edits and was authored by neither.
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
        if (attempt >= MAX_REPLACE_ATTEMPTS || !isRetryable(err)) throw err;
        this.logger.warn(
          `retrying translation-context save after a serialization conflict ` +
            `(attempt ${attempt} of ${MAX_REPLACE_ATTEMPTS}): ${String(err)}`,
        );
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

const STYLES = new Set<ContextStyle>(['neutral', 'formal', 'casual']);

function asStyle(value: string | null): ContextStyle {
  return value !== null && STYLES.has(value as ContextStyle)
    ? (value as ContextStyle)
    : null;
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

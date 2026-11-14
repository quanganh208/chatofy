// How a stored AI Context row is read and turned into the API contract:
// the columns every read selects, the mapping to `TranslationContext`, and
// the partition a full replace applies to stored glossary rows it cannot read.
// Split out of the Prisma store so the store holds only transactions.
import {
  CONTEXT_LIMITS,
  glossaryEntrySchema,
  type GlossaryEntry,
  type TranslationContext,
} from '@chatofy/types';
import type { Prisma } from '@prisma/client';
import {
  canEditRow,
  type LibraryScope,
} from '../../../common/library-scope/library-scope';

/**
 * The columns a read selects, and the shape {@link toContext} maps.
 *
 * `terms` is `unknown` rather than `GlossaryEntry`, deliberately: it is a JSONB
 * column, so Prisma hands back whatever bytes are actually stored, and a row a
 * past code path wrote in a shape this version no longer accepts must be
 * something {@link toContext} can catch rather than something the type checker
 * has been told to trust.
 */
export interface ContextRow {
  clientId: string;
  ownerId: string;
  name: string;
  topic: string | null;
  hotwords: string[];
  style: string | null;
  updatedAt: Date;
  glossary: { terms: unknown }[];
  linkedGlossary: {
    clientId: string;
    name: string;
    sourceLang: string;
    isActive: boolean;
    items: { original: string; translation: string; targetLang: string }[];
  } | null;
}

/**
 * The columns every read selects.
 *
 * Glossary entries are ordered by `position`, which is the column the save wrote
 * from the array index — Postgres has no inherent row order, so the order the
 * operator authored survives only because it is asked for here.
 */
export const CONTEXT_SELECT = {
  clientId: true,
  ownerId: true,
  name: true,
  topic: true,
  hotwords: true,
  style: true,
  updatedAt: true,
  glossary: {
    orderBy: { position: 'asc' },
    select: { terms: true },
  },
  linkedGlossary: {
    select: {
      clientId: true,
      name: true,
      sourceLang: true,
      isActive: true,
      items: {
        select: { original: true, translation: true, targetLang: true },
      },
    },
  },
} as const;

/**
 * `scope` decides only `canEdit`, which team rows carry and personal rows do
 * not; `ownerId` is read for it and never returned.
 */
export function toContext(
  row: ContextRow,
  scope: LibraryScope,
): TranslationContext {
  // When an ACTIVE Glossary is linked, derive preferred renderings from its
  // items. An inactive or absent one falls back to the inline GlossaryTerm rows:
  // switching a glossary off must stop it reaching the translator, while the
  // link itself stays visible in the editor.
  const linked = row.linkedGlossary?.isActive ? row.linkedGlossary : null;
  const glossary = linked
    ? glossaryItemsToEntries(linked.sourceLang, linked.items)
    : row.glossary
        .map((entry) => entry.terms)
        .map(asGlossaryEntry)
        .filter(isNotNull);

  return {
    id: row.clientId,
    name: row.name,
    topic: row.topic,
    hotwords: row.hotwords,
    // Stored as text so a new register is not a column migration; narrowed here
    // rather than trusted, because the column admits anything a past write put
    // there and the contract admits three values.
    style: asStyle(row.style),
    glossary,
    // The client id, never the stored cuid: the contract types both as the
    // glossary's client-minted uuid, and a cuid here fails the client's parse
    // and drops the whole context from the list.
    glossaryId: row.linkedGlossary?.clientId ?? null,
    linkedGlossaryId: row.linkedGlossary?.clientId ?? null,
    linkedGlossaryName: row.linkedGlossary?.name ?? null,
    updatedAt: row.updatedAt.toISOString(),
    ...(scope.kind === 'team'
      ? { canEdit: canEditRow(scope, row.ownerId) }
      : {}),
  };
}

/**
 * Convert a Glossary's items into the multilang `GlossaryEntry[]` format that
 * the translation prompt expects.
 *
 * Groups items by their `original` term so all target languages for the same
 * source phrase end up in a single entry. Only entries with at least two
 * language sides pass `glossaryEntrySchema` and are kept.
 */
function glossaryItemsToEntries(
  sourceLang: string,
  items: { original: string; translation: string; targetLang: string }[],
): GlossaryEntry[] {
  const byOriginal = new Map<string, Record<string, string>>();
  for (const item of items) {
    const entry = byOriginal.get(item.original) ?? {
      [sourceLang]: item.original,
    };
    entry[item.targetLang] = item.translation;
    byOriginal.set(item.original, entry);
  }
  return [...byOriginal.values()]
    .map(asGlossaryEntry)
    .filter(isNotNull)
    .slice(0, CONTEXT_LIMITS.MAX_GLOSSARY);
}

/**
 * One stored glossary row, validated against the same schema the request body
 * was — or `null` for a row a past code path corrupted.
 *
 * A read has to be defensive here in a way a Prisma-typed column never needs to
 * be, precisely because `terms` is JSONB: Postgres accepts any JSON value, so
 * `glossaryEntrySchema` is the only thing standing between a row this version
 * cannot make sense of and a `TranslationContext` that silently carries garbage
 * into a translation prompt. Dropped rather than thrown, so one bad row costs
 * its own entry and not the rest of the context the operator is trying to read.
 *
 * Not logged here: every read of the same context would repeat the same line
 * forever. The row is still in the table, and {@link partitionStoredGlossary}
 * reports it once, on the save that decides whether it is kept.
 */
function asGlossaryEntry(terms: unknown): GlossaryEntry | null {
  const parsed = glossaryEntrySchema.safeParse(terms);
  return parsed.success ? parsed.data : null;
}

/** What a replace does with the rows already stored for the context. */
interface StoredGlossaryPartition {
  /** Unreadable rows to append after the body's entries, in position order. */
  preserved: Prisma.InputJsonObject[];
  /** Rows whose `terms` is JSON `null` or not an object: nothing to preserve. */
  discardedEmpty: number;
  /** Unreadable rows past the glossary cap, dropped from the tail. */
  discardedOverCap: number;
}

/**
 * Split the stored rows (already in `position` order) into the unreadable ones a
 * replace carries forward and the ones it lets go.
 *
 * - A row the current schema reads is never preserved: the editor showed it, so
 *   the body either re-sent it or the operator deleted it on purpose.
 * - A row whose `terms` is not a JSON object — `null`, an array, a scalar — is
 *   discarded. It holds no rendering in any language, so there is nothing to
 *   keep, and re-inserting a JSON `null` into the required column would fail
 *   every later save of this context.
 * - The rest count against the same cap the body is held to, and `room` is
 *   what the body left of it. When they do not fit, the EARLIEST by position
 *   are kept and the tail is dropped — the rule this store applies everywhere,
 *   where position order decides what survives a cap. Without this, a context
 *   whose body is already at the cap would grow past it on every save that
 *   preserved something, and those rows cannot be removed from the editor,
 *   which never sees them; deleting the whole context is the only other exit.
 */
export function partitionStoredGlossary(
  stored: unknown[],
  room: number,
): StoredGlossaryPartition {
  let discardedEmpty = 0;
  const unreadable: Prisma.InputJsonObject[] = [];
  for (const terms of stored) {
    if (glossaryEntrySchema.safeParse(terms).success) continue;
    if (typeof terms !== 'object' || terms === null || Array.isArray(terms)) {
      discardedEmpty += 1;
      continue;
    }
    // A non-null, non-array JSONB value read back by Prisma is a JSON object;
    // carried through byte-for-byte, since re-validating would drop it again.
    unreadable.push(terms);
  }
  const kept = unreadable.slice(0, Math.max(0, room));
  return {
    preserved: kept,
    discardedEmpty,
    discardedOverCap: unreadable.length - kept.length,
  };
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
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

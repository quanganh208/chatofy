// Backend-agnostic store for a user's glossary, mirroring the MinutesStore seam:
// the default is in-memory (dev/test), and a PrismaGlossaryStore can replace it
// without touching the service or controller.
import type { GlossaryTerm, GlossaryTermRecord } from '@chatofy/types';

/** DI injection token for the glossary store. */
export const GLOSSARY_STORE = Symbol('GLOSSARY_STORE');

/** How an import reconciles with what the user already has. */
export type GlossaryImportMode = 'merge' | 'replace';

/**
 * Raised when a write would collide with the (owner, vi, en) uniqueness — a
 * duplicate pair. A sentinel type rather than a leaked Prisma error so the
 * service can map it to a 409 without either store exposing its backend.
 */
export class DuplicateGlossaryTermError extends Error {
  constructor(
    readonly vi: string,
    readonly en: string,
  ) {
    super(`glossary term already exists: ${vi} / ${en}`);
    this.name = 'DuplicateGlossaryTermError';
  }
}

/**
 * A user's glossary — a set of term pairs plus keep-verbatim entries.
 *
 * Every method is scoped by `ownerId` — the authenticated caller's user id, read
 * from the verified token, never from the request body or path. This is the
 * store-level half of the ownership guarantee: a caller can only ever read or
 * mutate its own glossary, so an `id` guessed or copied from another user
 * resolves to `null` here rather than to their term.
 *
 * Uniqueness is the exact `(ownerId, vi, en)` triple, matching the table's
 * compound key. It is deliberately NOT the fold-insensitive match used at
 * translation time — storage keeps what the user typed; only injection folds.
 */
export interface GlossaryStore {
  /** The caller's whole glossary, order unspecified. */
  list(ownerId: string): Promise<GlossaryTermRecord[]>;
  /** Add one term. Throws {@link DuplicateGlossaryTermError} on a duplicate pair. */
  create(ownerId: string, term: GlossaryTerm): Promise<GlossaryTermRecord>;
  /**
   * Patch one term. Returns null when the id is absent or owned by someone else;
   * throws {@link DuplicateGlossaryTermError} when the patch would collide with
   * another of the caller's terms.
   */
  update(
    ownerId: string,
    id: string,
    patch: Partial<GlossaryTerm>,
  ): Promise<GlossaryTermRecord | null>;
  /** Delete one term; returns the removed record, or null when absent/not owned. */
  remove(ownerId: string, id: string): Promise<GlossaryTermRecord | null>;
  /**
   * Bulk import. `merge` upserts each pair (existing pairs keep their id, their
   * `keepVerbatim` is updated); `replace` deletes the caller's whole glossary
   * first. Returns the resulting glossary.
   */
  importTerms(
    ownerId: string,
    terms: readonly GlossaryTerm[],
    mode: GlossaryImportMode,
  ): Promise<GlossaryTermRecord[]>;
}

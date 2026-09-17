// Backend-agnostic store for a user's AI Context library, mirroring the
// CONVERSATION_STORE seam: the interface is what lets a test substitute an
// in-memory double without a Postgres, and what keeps the service free of
// Prisma types.
import type {
  SaveTranslationContextRequest,
  TranslationContext,
} from '@chatofy/types';

/** DI injection token for the translation-context store. */
export const TRANSLATION_CONTEXT_STORE = Symbol('TRANSLATION_CONTEXT_STORE');

/**
 * Every method is scoped by `ownerId` — the authenticated caller's user id, read
 * from the verified token, never from the request path or body. That is the
 * store-level half of the ownership guarantee: a `contextId` guessed or copied
 * from another user resolves to `null` here rather than to their dictionary, so
 * a foreign id and an absent one are indistinguishable to the caller.
 *
 * `contextId` throughout is the CLIENT-minted id that appears in URLs, not the
 * row's server cuid. The two are different values and conflating them is how an
 * ownership check gets skipped.
 */
export interface TranslationContextStore {
  /** The caller's whole library, newest first. Unpaged — it is bounded at 20. */
  list(ownerId: string): Promise<TranslationContext[]>;

  /**
   * Create or fully replace the caller's context under this client id.
   *
   * A save is a FULL REPLACEMENT, including the glossary: the client owns the id
   * and re-sends the whole context, so entries are deleted and re-created rather
   * than merged — a shorter re-save must not leave a stale tail of pairs the
   * operator removed.
   */
  save(
    ownerId: string,
    contextId: string,
    body: SaveTranslationContextRequest,
  ): Promise<TranslationContext>;

  /**
   * Delete the caller's context under this client id.
   *
   * Returns whether a row was actually removed, so the controller can answer 204
   * either way without a second read — and without the answer differing between
   * "never existed" and "belongs to someone else".
   */
  remove(ownerId: string, contextId: string): Promise<boolean>;

  /** How many contexts the caller holds, for the per-owner ceiling. */
  count(ownerId: string): Promise<number>;
}

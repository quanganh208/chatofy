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
   * Create or fully replace the caller's context under this client id, refusing
   * a CREATE that would take the owner past `maxPerOwner`.
   *
   * A save is a FULL REPLACEMENT, including the glossary: the client owns the id
   * and re-sends the whole context, so entries are deleted and re-created rather
   * than merged — a shorter re-save must not leave a stale tail of pairs the
   * operator removed.
   *
   * ## Why the ceiling is counted here
   *
   * "At most N rows per owner" is a COUNT, and Postgres has no constraint over
   * one — so the only thing that can serialise the count against the insert is
   * the transaction the insert already runs in. An implementation must read the
   * count and write the row atomically; a count taken by the caller beforehand
   * is a read with nothing holding it, and two creates fired together at N-1
   * both pass it.
   *
   * `maxPerOwner` is passed IN rather than read from the contract, so this stays
   * a rule about rows the store is TOLD to hold, not a product decision the
   * persistence layer makes for itself.
   *
   * ## Why a refusal is `null` rather than a throw
   *
   * What a breached ceiling means to a caller — a status code, a sentence the
   * user reads — belongs to the service. A store that threw `ConflictException`
   * would put HTTP in the persistence layer, and a store that threw anything
   * else would need the service to unwrap it. `null` says only "the row was not
   * written because the ceiling refused it", which is the whole of what this
   * layer knows.
   */
  save(
    ownerId: string,
    contextId: string,
    body: SaveTranslationContextRequest,
    maxPerOwner: number,
  ): Promise<TranslationContext | null>;

  /**
   * Delete the caller's context under this client id.
   *
   * Returns whether a row was actually removed, so the controller can answer 204
   * either way without a second read — and without the answer differing between
   * "never existed" and "belongs to someone else".
   */
  remove(ownerId: string, contextId: string): Promise<boolean>;
}

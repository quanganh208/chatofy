import type {
  Glossary,
  GlossaryItem,
  PatchGlossaryRequest,
  SaveGlossaryItemRequest,
  SaveGlossaryRequest,
} from '@chatofy/types';

/** DI injection token for the glossary store. */
export const GLOSSARY_STORE = Symbol('GLOSSARY_STORE');

/**
 * Backend-agnostic seam for a user's named glossary collections.
 *
 * Every method is scoped by `ownerId` from the verified JWT — never from a path
 * or body field. A `glossaryId` belonging to another owner resolves to `null`
 * rather than to their data, so a foreign id and an absent one are
 * indistinguishable to the caller.
 */
export interface GlossaryStore {
  /** All glossaries for `ownerId`, newest first. Unpaged — bounded at 20. */
  listGlossaries(ownerId: string): Promise<Glossary[]>;

  /**
   * Create or replace one glossary's metadata (name, description, sourceLang).
   *
   * Returns `null` only when a CREATE would exceed `maxPerOwner`. A REPLACE of
   * an existing glossary is never refused — the caller owns the id, and
   * refusing a replace of a full library leaves it permanently uneditable.
   */
  saveGlossary(
    ownerId: string,
    glossaryId: string,
    body: SaveGlossaryRequest,
    maxPerOwner: number,
  ): Promise<Glossary | null>;

  /**
   * Toggle `isActive` or set `isDefault` on one glossary.
   *
   * Setting `isDefault: true` clears `isDefault` on every other row for this
   * owner atomically. Returns `null` when the glossary does not exist or does
   * not belong to `ownerId`.
   */
  patchGlossary(
    ownerId: string,
    glossaryId: string,
    body: PatchGlossaryRequest,
  ): Promise<Glossary | null>;

  /**
   * Delete one glossary and all its items via cascade.
   *
   * Returns whether a row was actually removed so the controller can answer 204
   * either way without a second read.
   */
  removeGlossary(ownerId: string, glossaryId: string): Promise<boolean>;

  /** All items for one glossary, creation-order ascending. */
  listItems(ownerId: string, glossaryId: string): Promise<GlossaryItem[]>;

  /**
   * Add one term pair to a glossary.
   *
   * `clientId` from the request body provides idempotency: a retry with the
   * same `clientId` returns the existing row rather than creating a duplicate.
   *
   * Returns `null` when the glossary does not exist or does not belong to
   * `ownerId`, or when the item count would exceed `maxPerGlossary`.
   */
  addItem(
    ownerId: string,
    glossaryId: string,
    body: SaveGlossaryItemRequest,
    maxPerGlossary: number,
  ): Promise<GlossaryItem | null>;

  /**
   * Delete one term pair.
   *
   * Returns whether a row was removed — the route answers 204 either way.
   */
  removeItem(
    ownerId: string,
    glossaryId: string,
    itemId: string,
  ): Promise<boolean>;
}

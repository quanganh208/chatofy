import type {
  Glossary,
  GlossaryItem,
  PatchGlossaryRequest,
  SaveGlossaryItemRequest,
  SaveGlossaryRequest,
} from '@chatofy/types';
import type { LibraryScope } from '../../../common/library-scope/library-scope';
import type {
  Refusal,
  RemoveResult,
  Saved,
} from '../../../common/library-scope/library-write-results';

/** DI injection token for the glossary store. */
export const GLOSSARY_STORE = Symbol('GLOSSARY_STORE');

/**
 * What {@link GlossaryStore.saveGlossary} did: wrote it; refused a CREATE past
 * the ceiling (`limit`); refused a team member editing a row they did not
 * author (`forbidden`); or refused a TEAM create whose client id is already
 * used by any glossary in any scope (`id-in-use`).
 */
export type GlossarySaveResult =
  | Saved<Glossary>
  | Refusal<'limit'>
  | Refusal<'forbidden'>
  | Refusal<'id-in-use'>;

/** What {@link GlossaryStore.patchGlossary} did: patched it, found no such glossary in scope, or refused a non-author member. */
export type GlossaryPatchResult =
  Saved<Glossary> | Refusal<'absent'> | Refusal<'forbidden'>;

/**
 * What {@link GlossaryStore.addItem} did: added (or, for a retried clientId,
 * returned) the item, refused it past the item ceiling, or found no such
 * glossary in scope.
 */
export type ItemAddResult =
  | Saved<GlossaryItem>
  | Refusal<'limit'>
  | Refusal<'absent'>
  | Refusal<'forbidden'>;

/**
 * Backend-agnostic seam for named glossary collections.
 *
 * Every method is confined to one {@link LibraryScope}: the caller's personal
 * library (built from the verified JWT, never from a path or body field) or a
 * team's, which only membership can mint. A `glossaryId` outside that scope
 * resolves to nothing rather than to someone else's data, so a foreign id and
 * an absent one are indistinguishable to the caller.
 */
export interface GlossaryStore {
  /** All glossaries in the scope, newest first. Unpaged — bounded at 20. */
  listGlossaries(scope: LibraryScope): Promise<Glossary[]>;

  /**
   * Create or replace one glossary's metadata (name, description, sourceLang).
   *
   * Refuses with `limit` only when a CREATE would take the scope past
   * `maxPerOwner`. A REPLACE of an existing glossary is never refused — the
   * caller owns the id, and refusing a replace of a full library leaves it
   * permanently uneditable.
   */
  saveGlossary(
    scope: LibraryScope,
    glossaryId: string,
    body: SaveGlossaryRequest,
    maxPerOwner: number,
  ): Promise<GlossarySaveResult>;

  /** Toggle `isActive` on one glossary; `absent` when it is not in the scope. */
  patchGlossary(
    scope: LibraryScope,
    glossaryId: string,
    body: PatchGlossaryRequest,
  ): Promise<GlossaryPatchResult>;

  /**
   * Delete one glossary and all its items via cascade.
   *
   * Personal routes answer 204 for both `removed` and `absent`; `forbidden` is
   * a team member deleting a glossary they did not author.
   */
  removeGlossary(
    scope: LibraryScope,
    glossaryId: string,
  ): Promise<RemoveResult>;

  /** All items for one glossary, creation-order ascending; empty when it is not in the scope. */
  listItems(scope: LibraryScope, glossaryId: string): Promise<GlossaryItem[]>;

  /**
   * Add one term pair to a glossary.
   *
   * `clientId` from the request body provides idempotency: a retry with the
   * same `clientId` returns the existing row rather than creating a duplicate.
   */
  addItem(
    scope: LibraryScope,
    glossaryId: string,
    body: SaveGlossaryItemRequest,
    maxPerGlossary: number,
  ): Promise<ItemAddResult>;

  /**
   * Delete one term pair.
   *
   * The route answers 204 for both `removed` and `absent`; `forbidden` is a
   * team member editing a glossary they did not author.
   */
  removeItem(
    scope: LibraryScope,
    glossaryId: string,
    itemId: string,
  ): Promise<RemoveResult>;
}

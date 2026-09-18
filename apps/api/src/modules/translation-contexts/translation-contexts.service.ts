import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
  type TranslationContext,
} from '@chatofy/types';
import {
  TRANSLATION_CONTEXT_STORE,
  type TranslationContextStore,
} from './interfaces/translation-context-store.interface';

/**
 * The AI Context library, and the per-owner ceiling.
 *
 * Thin by design — the store owns ownership scoping, the transactional replace,
 * and now the ceiling's arithmetic too. What is left here is the half of the
 * ceiling that is a product decision rather than a row operation: WHICH number
 * the library is held to, and what a caller who breaches it is told.
 *
 * The arithmetic moved down because it could not be made correct up here. "At
 * most 20 rows per owner" is a COUNT, Postgres has no constraint over one, and a
 * count this service took before calling the store was a read with nothing
 * holding it — two creates fired together at 19 both saw room and both
 * committed. Only the store can read the count inside the same transaction as
 * the insert, so that is where it is read.
 */
@Injectable()
export class TranslationContextsService {
  constructor(
    @Inject(TRANSLATION_CONTEXT_STORE)
    private readonly store: TranslationContextStore,
  ) {}

  list(ownerId: string): Promise<TranslationContext[]> {
    return this.store.list(ownerId);
  }

  /**
   * Create or replace one context, turning a refused CREATE into a 409.
   *
   * The store is handed the ceiling rather than knowing it: the number is the
   * contract's, and a persistence layer that read `CONTEXT_LIMITS` itself would
   * be making the product's decision on its behalf. What comes back is `null`
   * when the ceiling refused the write, and that is the only thing the store
   * says about it — the status code and the sentence the user reads are built
   * here, where the HTTP contract lives.
   *
   * A REPLACE of a context the caller already holds is never refused, because it
   * adds no row. That rule is the store's to apply, since only it can tell a
   * create from a replace atomically with the write; the reason it exists is
   * this one: refusing a replace would make a full library permanently
   * uneditable, and the only way out would be a delete the user did not ask to
   * make.
   */
  async save(
    ownerId: string,
    contextId: string,
    body: SaveTranslationContextRequest,
  ): Promise<TranslationContext> {
    const saved = await this.store.save(
      ownerId,
      contextId,
      body,
      CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER,
    );
    if (saved === null) {
      throw new ConflictException(
        `You can save at most ${CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER} AI Contexts. ` +
          'Delete one before creating another.',
      );
    }
    return saved;
  }

  /**
   * Delete one context.
   *
   * The store's answer is deliberately discarded: the route is 204 whether a row
   * went or not, so an id that was never there and one belonging to someone else
   * are indistinguishable to the caller.
   */
  async remove(ownerId: string, contextId: string): Promise<void> {
    await this.store.remove(ownerId, contextId);
  }
}

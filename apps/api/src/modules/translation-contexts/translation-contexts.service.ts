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
 * The AI Context library, and the one rule the store does not enforce.
 *
 * Thin by design — the store already owns ownership scoping and the
 * transactional replace. What lives here is the per-owner ceiling, because it is
 * a decision about the product rather than about a row, and because it cannot be
 * expressed as a constraint: "at most 20 rows per owner" is a COUNT, and Postgres
 * has no constraint over one.
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
   * Create or replace one context, refusing only a CREATE past the ceiling.
   *
   * Counting first and deciding second is the whole of it, and the order
   * matters: a replace of a context the caller already holds adds no row, so
   * refusing it would make a full library permanently uneditable — the user
   * could neither add to it nor fix what is in it, and the only way out would be
   * a delete they did not ask to make.
   *
   * The membership read is paid only AT the ceiling. Below it the count alone
   * answers the question, and the list is bounded at
   * `MAX_CONTEXTS_PER_OWNER` rows, so the expensive branch is also the rare one.
   */
  async save(
    ownerId: string,
    contextId: string,
    body: SaveTranslationContextRequest,
  ): Promise<TranslationContext> {
    const held = await this.store.count(ownerId);
    if (held >= CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER) {
      const existing = await this.store.list(ownerId);
      if (!existing.some((context) => context.id === contextId)) {
        throw new ConflictException(
          `You can save at most ${CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER} AI Contexts. ` +
            'Delete one before creating another.',
        );
      }
    }
    return this.store.save(ownerId, contextId, body);
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

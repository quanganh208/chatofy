import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  CONTEXT_LIMITS,
  TEAM_LIMITS,
  type AvailableTranslationContexts,
  type SaveTranslationContextRequest,
  type TranslationContext,
} from '@chatofy/types';
import {
  TRANSLATION_CONTEXT_STORE,
  type TranslationContextStore,
} from './interfaces/translation-context-store.interface';
import { assertNever } from '../../common/library-scope/library-write-results';
import {
  personalScope,
  type LibraryScope,
} from '../../common/library-scope/library-scope';
import { TeamAccessService } from '../teams/team-access.service';

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
    private readonly access: TeamAccessService,
  ) {}

  list(scope: LibraryScope): Promise<TranslationContext[]> {
    return this.store.list(scope);
  }

  /**
   * Every context the caller may use, grouped by the scope it lives in.
   *
   * Memberships are read once; teams come in `joinedAt` order because
   * `memberships()` returns them that way. The per-scope lists run in one
   * `Promise.all`: at most 1 + 5 reads, bounded by the 5-team cap.
   */
  async listAvailable(userId: string): Promise<AvailableTranslationContexts> {
    const memberships = await this.access.memberships(userId);
    const [personal, ...teamLists] = await Promise.all([
      this.store.list(personalScope(userId)),
      ...memberships.map((m) => this.store.list(m.scope)),
    ]);
    return {
      personal: personal,
      teams: memberships.map((m, i) => ({
        teamId: m.team.id,
        name: m.team.name,
        contexts: teamLists[i]!,
      })),
    };
  }

  /**
   * Create or replace one context, turning a refused CREATE into a 409 and a
   * glossary link the caller does not hold into a 400.
   *
   * The store is handed the ceiling rather than knowing it: the number is the
   * contract's, and a persistence layer that read `CONTEXT_LIMITS` itself would
   * be making the product's decision on its behalf. What comes back is a result
   * kind naming why a write was refused, and that is the only thing the store
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
    scope: LibraryScope,
    contextId: string,
    body: SaveTranslationContextRequest,
  ): Promise<TranslationContext> {
    const max =
      scope.kind === 'team'
        ? TEAM_LIMITS.MAX_CONTEXTS_PER_TEAM
        : CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER;
    const saved = await this.store.save(scope, contextId, body, max);
    switch (saved.kind) {
      case 'saved':
        return saved.value;
      case 'limit':
        throw new ConflictException(
          `You can save at most ${max} AI Contexts. ` +
            'Delete one before creating another.',
        );
      case 'glossary-missing':
        throw new BadRequestException('The linked glossary does not exist.');
      case 'forbidden':
        throw notTheAuthor();
      case 'id-in-use':
        throw new ConflictException(
          'This id is already used by another AI Context. Save it under a new id.',
        );
      default:
        return assertNever(saved);
    }
  }

  /**
   * Delete one context.
   *
   * `removed` and `absent` both answer 204, so an id that was never there and
   * one belonging to someone else are indistinguishable to the caller. Only a
   * team member deleting a context they did not author is refused.
   */
  async remove(scope: LibraryScope, contextId: string): Promise<void> {
    const removed = await this.store.remove(scope, contextId);
    switch (removed) {
      case 'removed':
      case 'absent':
        return;
      case 'forbidden':
        throw notTheAuthor();
      default:
        return assertNever(removed);
    }
  }
}

/** A member writing a team row they did not author; the same text as glossaries. */
function notTheAuthor(): ForbiddenException {
  return new ForbiddenException(
    'Only the author or a team admin can change this.',
  );
}

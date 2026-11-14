import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GLOSSARY_LIMITS,
  TEAM_LIMITS,
  type Glossary,
  type GlossaryItem,
  type PatchGlossaryRequest,
  type SaveGlossaryItemRequest,
  type SaveGlossaryRequest,
} from '@chatofy/types';
import {
  GLOSSARY_STORE,
  type GlossaryStore,
} from './interfaces/glossary-store.interface';
import type { LibraryScope } from '../../common/library-scope/library-scope';
import {
  assertNever,
  type RemoveResult,
} from '../../common/library-scope/library-write-results';

/** A member writing a team row they did not author. */
function notTheAuthor(): ForbiddenException {
  return new ForbiddenException(
    'Only the author or a team admin can change this.',
  );
}

/**
 * `removed` and `absent` both answer 204, as personal deletes always have;
 * only a non-author member is refused.
 */
function settleRemove(result: RemoveResult): void {
  switch (result) {
    case 'removed':
    case 'absent':
      return;
    case 'forbidden':
      throw notTheAuthor();
    default:
      return assertNever(result);
  }
}

@Injectable()
export class GlossariesService {
  constructor(
    @Inject(GLOSSARY_STORE)
    private readonly store: GlossaryStore,
  ) {}

  listGlossaries(scope: LibraryScope): Promise<Glossary[]> {
    return this.store.listGlossaries(scope);
  }

  async saveGlossary(
    scope: LibraryScope,
    glossaryId: string,
    body: SaveGlossaryRequest,
  ): Promise<Glossary> {
    const max = maxGlossaries(scope);
    const saved = await this.store.saveGlossary(scope, glossaryId, body, max);
    switch (saved.kind) {
      case 'saved':
        return saved.value;
      case 'limit':
        throw new ConflictException(
          `You can save at most ${max} glossaries. ` +
            'Delete one before creating another.',
        );
      case 'forbidden':
        throw notTheAuthor();
      case 'id-in-use':
        throw new ConflictException(
          'This id is already used by another glossary. Save it under a new id.',
        );
      default:
        return assertNever(saved);
    }
  }

  async patchGlossary(
    scope: LibraryScope,
    glossaryId: string,
    body: PatchGlossaryRequest,
  ): Promise<Glossary> {
    const patched = await this.store.patchGlossary(scope, glossaryId, body);
    switch (patched.kind) {
      case 'saved':
        return patched.value;
      case 'absent':
        throw new NotFoundException('Glossary not found.');
      case 'forbidden':
        throw notTheAuthor();
      default:
        return assertNever(patched);
    }
  }

  async removeGlossary(scope: LibraryScope, glossaryId: string): Promise<void> {
    settleRemove(await this.store.removeGlossary(scope, glossaryId));
  }

  listItems(scope: LibraryScope, glossaryId: string): Promise<GlossaryItem[]> {
    return this.store.listItems(scope, glossaryId);
  }

  async addItem(
    scope: LibraryScope,
    glossaryId: string,
    body: SaveGlossaryItemRequest,
  ): Promise<GlossaryItem> {
    const item = await this.store.addItem(
      scope,
      glossaryId,
      body,
      GLOSSARY_LIMITS.MAX_ITEMS_PER_GLOSSARY,
    );
    switch (item.kind) {
      case 'saved':
        return item.value;
      // One answer for both, as before: a full glossary and a missing one
      // read the same to the caller.
      case 'limit':
      case 'absent':
        throw new ConflictException(
          `This glossary is full (max ${GLOSSARY_LIMITS.MAX_ITEMS_PER_GLOSSARY} terms) or does not exist.`,
        );
      case 'forbidden':
        throw notTheAuthor();
      default:
        return assertNever(item);
    }
  }

  async removeItem(
    scope: LibraryScope,
    glossaryId: string,
    itemId: string,
  ): Promise<void> {
    settleRemove(await this.store.removeItem(scope, glossaryId, itemId));
  }
}

/** A team holds its own ceiling; a person keeps the personal one. */
function maxGlossaries(scope: LibraryScope): number {
  return scope.kind === 'team'
    ? TEAM_LIMITS.MAX_GLOSSARIES_PER_TEAM
    : GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER;
}

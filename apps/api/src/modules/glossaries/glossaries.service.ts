import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GLOSSARY_LIMITS,
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
import { assertNever } from '../../common/library-scope/library-write-results';

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
    const saved = await this.store.saveGlossary(
      scope,
      glossaryId,
      body,
      GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER,
    );
    switch (saved.kind) {
      case 'saved':
        return saved.value;
      case 'limit':
        throw new ConflictException(
          `You can save at most ${GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER} glossaries. ` +
            'Delete one before creating another.',
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
      default:
        return assertNever(patched);
    }
  }

  async removeGlossary(scope: LibraryScope, glossaryId: string): Promise<void> {
    await this.store.removeGlossary(scope, glossaryId);
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
      default:
        return assertNever(item);
    }
  }

  async removeItem(
    scope: LibraryScope,
    glossaryId: string,
    itemId: string,
  ): Promise<void> {
    await this.store.removeItem(scope, glossaryId, itemId);
  }
}

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

@Injectable()
export class GlossariesService {
  constructor(
    @Inject(GLOSSARY_STORE)
    private readonly store: GlossaryStore,
  ) {}

  listGlossaries(ownerId: string): Promise<Glossary[]> {
    return this.store.listGlossaries(ownerId);
  }

  async saveGlossary(
    ownerId: string,
    glossaryId: string,
    body: SaveGlossaryRequest,
  ): Promise<Glossary> {
    const saved = await this.store.saveGlossary(
      ownerId,
      glossaryId,
      body,
      GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER,
    );
    if (saved === null) {
      throw new ConflictException(
        `You can save at most ${GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER} glossaries. ` +
          'Delete one before creating another.',
      );
    }
    return saved;
  }

  async patchGlossary(
    ownerId: string,
    glossaryId: string,
    body: PatchGlossaryRequest,
  ): Promise<Glossary> {
    const patched = await this.store.patchGlossary(ownerId, glossaryId, body);
    if (patched === null) {
      throw new NotFoundException('Glossary not found.');
    }
    return patched;
  }

  async removeGlossary(ownerId: string, glossaryId: string): Promise<void> {
    await this.store.removeGlossary(ownerId, glossaryId);
  }

  listItems(ownerId: string, glossaryId: string): Promise<GlossaryItem[]> {
    return this.store.listItems(ownerId, glossaryId);
  }

  async addItem(
    ownerId: string,
    glossaryId: string,
    body: SaveGlossaryItemRequest,
  ): Promise<GlossaryItem> {
    const item = await this.store.addItem(
      ownerId,
      glossaryId,
      body,
      GLOSSARY_LIMITS.MAX_ITEMS_PER_GLOSSARY,
    );
    if (item === null) {
      throw new ConflictException(
        `This glossary is full (max ${GLOSSARY_LIMITS.MAX_ITEMS_PER_GLOSSARY} terms) or does not exist.`,
      );
    }
    return item;
  }

  async removeItem(
    ownerId: string,
    glossaryId: string,
    itemId: string,
  ): Promise<void> {
    await this.store.removeItem(ownerId, glossaryId, itemId);
  }
}

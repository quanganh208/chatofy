import { Injectable } from '@nestjs/common';
import type {
  Glossary,
  GlossaryItem,
  LanguageCode,
  PatchGlossaryRequest,
  SaveGlossaryItemRequest,
  SaveGlossaryRequest,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import type { GlossaryStore } from '../interfaces/glossary-store.interface';

@Injectable()
export class PrismaGlossaryStore implements GlossaryStore {
  constructor(private readonly prisma: PrismaService) {}

  async listGlossaries(ownerId: string): Promise<Glossary[]> {
    const rows = await this.prisma.glossary.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      select: GLOSSARY_SELECT,
    });
    return rows.map(toGlossary);
  }

  async saveGlossary(
    ownerId: string,
    glossaryId: string,
    body: SaveGlossaryRequest,
    maxPerOwner: number,
  ): Promise<Glossary | null> {
    return this.prisma.$transaction(async (tx) => {
      const held = await tx.glossary.findUnique({
        where: { ownerId_clientId: { ownerId, clientId: glossaryId } },
        select: { id: true },
      });

      if (held === null) {
        const owned = await tx.glossary.count({ where: { ownerId } });
        if (owned >= maxPerOwner) return null;
      }

      const row = await tx.glossary.upsert({
        where: { ownerId_clientId: { ownerId, clientId: glossaryId } },
        create: {
          ownerId,
          clientId: glossaryId,
          name: body.name,
          description: body.description,
          sourceLang: body.sourceLang,
        },
        update: {
          name: body.name,
          description: body.description,
          sourceLang: body.sourceLang,
        },
        select: GLOSSARY_SELECT,
      });
      return toGlossary(row);
    });
  }

  async patchGlossary(
    ownerId: string,
    glossaryId: string,
    body: PatchGlossaryRequest,
  ): Promise<Glossary | null> {
    return this.prisma.$transaction(async (tx) => {
      const held = await tx.glossary.findUnique({
        where: { ownerId_clientId: { ownerId, clientId: glossaryId } },
        select: { id: true },
      });
      if (held === null) return null;

      const row = await tx.glossary.update({
        where: { id: held.id },
        data: { isActive: body.isActive },
        select: GLOSSARY_SELECT,
      });
      return toGlossary(row);
    });
  }

  async removeGlossary(ownerId: string, glossaryId: string): Promise<boolean> {
    const { count } = await this.prisma.glossary.deleteMany({
      where: { ownerId, clientId: glossaryId },
    });
    return count > 0;
  }

  async listItems(
    ownerId: string,
    glossaryId: string,
  ): Promise<GlossaryItem[]> {
    // Ownership is enforced through the glossary relation — if the glossary does
    // not belong to this owner it simply returns an empty list.
    const glossary = await this.prisma.glossary.findUnique({
      where: { ownerId_clientId: { ownerId, clientId: glossaryId } },
      select: { id: true },
    });
    if (glossary === null) return [];

    const rows = await this.prisma.glossaryItem.findMany({
      where: { glossaryId: glossary.id },
      orderBy: { createdAt: 'asc' },
      select: ITEM_SELECT,
    });
    return rows.map((r) => toItem(r, glossaryId));
  }

  async addItem(
    ownerId: string,
    glossaryId: string,
    body: SaveGlossaryItemRequest,
    maxPerGlossary: number,
  ): Promise<GlossaryItem | null> {
    return this.prisma.$transaction(async (tx) => {
      const glossary = await tx.glossary.findUnique({
        where: { ownerId_clientId: { ownerId, clientId: glossaryId } },
        select: { id: true },
      });
      if (glossary === null) return null;

      // Idempotency: if the clientId already exists, return the existing row.
      const existing = await tx.glossaryItem.findUnique({
        where: {
          glossaryId_clientId: {
            glossaryId: glossary.id,
            clientId: body.clientId,
          },
        },
        select: ITEM_SELECT,
      });
      if (existing !== null) return toItem(existing, glossaryId);

      const itemCount = await tx.glossaryItem.count({
        where: { glossaryId: glossary.id },
      });
      if (itemCount >= maxPerGlossary) return null;

      const row = await tx.glossaryItem.create({
        data: {
          clientId: body.clientId,
          glossaryId: glossary.id,
          original: body.original,
          translation: body.translation,
          targetLang: body.targetLang,
          notes: body.notes,
        },
        select: ITEM_SELECT,
      });
      return toItem(row, glossaryId);
    });
  }

  async removeItem(
    ownerId: string,
    glossaryId: string,
    itemId: string,
  ): Promise<boolean> {
    const glossary = await this.prisma.glossary.findUnique({
      where: { ownerId_clientId: { ownerId, clientId: glossaryId } },
      select: { id: true },
    });
    if (glossary === null) return false;

    // `itemId` is the client-minted id the API hands out, not the row's own
    // primary key; `(glossaryId, clientId)` is unique, so this hits one row.
    const { count } = await this.prisma.glossaryItem.deleteMany({
      where: { clientId: itemId, glossaryId: glossary.id },
    });
    return count > 0;
  }
}

interface GlossaryRow {
  clientId: string;
  name: string;
  description: string | null;
  sourceLang: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { items: number };
}

interface ItemRow {
  clientId: string;
  original: string;
  translation: string;
  targetLang: string;
  notes: string | null;
  createdAt: Date;
}

const GLOSSARY_SELECT = {
  clientId: true,
  name: true,
  description: true,
  sourceLang: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} as const;

const ITEM_SELECT = {
  clientId: true,
  original: true,
  translation: true,
  targetLang: true,
  notes: true,
  createdAt: true,
} as const;

function toGlossary(row: GlossaryRow): Glossary {
  return {
    id: row.clientId,
    name: row.name,
    description: row.description,
    sourceLang: row.sourceLang as LanguageCode,
    isActive: row.isActive,
    itemCount: row._count.items,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The public id of a term is its client-minted UUID, exactly as for a glossary.
 * The row's own `id` is a cuid the database mints and never leaves the store:
 * the shared contract types term ids as UUIDs, so handing out the cuid made
 * every term list fail the client's parse and every delete fail validation.
 */
function toItem(row: ItemRow, glossaryClientId: string): GlossaryItem {
  return {
    id: row.clientId,
    glossaryId: glossaryClientId,
    original: row.original,
    translation: row.translation,
    targetLang: row.targetLang as LanguageCode,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

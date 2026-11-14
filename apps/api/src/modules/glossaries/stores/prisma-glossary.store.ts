import { Injectable } from '@nestjs/common';
import type {
  GlossaryItem,
  LanguageCode,
  Glossary,
  PatchGlossaryRequest,
  SaveGlossaryItemRequest,
  SaveGlossaryRequest,
} from '@chatofy/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LOCK_CLASS } from '../../../common/library-scope/advisory-lock-classes';
import {
  canEditRow,
  scopeLockKey,
  scopeWhere,
  type LibraryScope,
} from '../../../common/library-scope/library-scope';
import type { RemoveResult } from '../../../common/library-scope/library-write-results';
import type {
  GlossaryPatchResult,
  GlossarySaveResult,
  GlossaryStore,
  ItemAddResult,
} from '../interfaces/glossary-store.interface';

/**
 * Postgres-backed glossary library.
 *
 * **Every query is confined by {@link scopeWhere}.** A team glossary keeps its
 * author in `ownerId`, so a filter on `ownerId` alone would reach the author's
 * team rows from a personal route. Rows are found with `findFirst` over the
 * scope and then written by their own `id`, never addressed through the
 * `(ownerId, clientId)` unique, which cannot carry `teamId: null`.
 *
 * **A save takes the scope's advisory lock first,** so the per-scope ceiling
 * count and the create it guards cannot interleave with another save in the
 * same scope (the reasoning is the context store's; see its `save`).
 * `addItem` stays unlocked, as it always was.
 *
 * **The author rule is checked inside each write's own transaction,** on the
 * row it is about to change: a team member may change only what they
 * authored, admins and the owner anything ({@link canEditRow}). Team rows are
 * returned with `canEdit`; the author's id never leaves this file.
 */
@Injectable()
export class PrismaGlossaryStore implements GlossaryStore {
  constructor(private readonly prisma: PrismaService) {}

  async listGlossaries(scope: LibraryScope): Promise<Glossary[]> {
    const rows = await this.prisma.glossary.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      select: GLOSSARY_SELECT,
    });
    return rows.map((row) => toGlossary(row, scope));
  }

  async saveGlossary(
    scope: LibraryScope,
    glossaryId: string,
    body: SaveGlossaryRequest,
    maxPerOwner: number,
  ): Promise<GlossarySaveResult> {
    return this.prisma.$transaction(async (tx) => {
      // FIRST: the count below only holds if no other save in this scope can
      // insert between it and the create.
      await lockScope(tx, scope);
      const held = await findHeld(tx, scope, glossaryId);
      const fields = {
        name: body.name,
        description: body.description,
        sourceLang: body.sourceLang,
      };

      if (held === null) {
        // A TEAM create refuses an id used anywhere in the model, so a member
        // cannot plant a glossary under an id another scope already reads.
        if (scope.kind === 'team' && (await idInUse(tx, glossaryId))) {
          return { kind: 'id-in-use' } as const;
        }
        const owned = await tx.glossary.count({ where: scopeWhere(scope) });
        if (owned >= maxPerOwner) return { kind: 'limit' } as const;
        const created = await tx.glossary.create({
          data: {
            ownerId: scope.userId,
            teamId: scope.kind === 'team' ? scope.teamId : null,
            clientId: glossaryId,
            ...fields,
          },
          select: GLOSSARY_SELECT,
        });
        return { kind: 'saved', value: toGlossary(created, scope) } as const;
      }

      if (!canEditRow(scope, held.ownerId)) {
        return { kind: 'forbidden' } as const;
      }
      const updated = await tx.glossary.update({
        where: { id: held.id },
        data: fields,
        select: GLOSSARY_SELECT,
      });
      return { kind: 'saved', value: toGlossary(updated, scope) } as const;
    });
  }

  async patchGlossary(
    scope: LibraryScope,
    glossaryId: string,
    body: PatchGlossaryRequest,
  ): Promise<GlossaryPatchResult> {
    return this.prisma.$transaction(async (tx) => {
      const held = await findHeld(tx, scope, glossaryId);
      if (held === null) return { kind: 'absent' } as const;
      if (!canEditRow(scope, held.ownerId)) {
        return { kind: 'forbidden' } as const;
      }

      const row = await tx.glossary.update({
        where: { id: held.id },
        data: { isActive: body.isActive },
        select: GLOSSARY_SELECT,
      });
      return { kind: 'saved', value: toGlossary(row, scope) } as const;
    });
  }

  async removeGlossary(
    scope: LibraryScope,
    glossaryId: string,
  ): Promise<RemoveResult> {
    return this.prisma.$transaction(async (tx) => {
      const held = await findHeld(tx, scope, glossaryId);
      if (held === null) return 'absent';
      if (!canEditRow(scope, held.ownerId)) return 'forbidden';
      // `deleteMany` by id: a concurrent delete that won the race leaves
      // nothing to delete, which reads as absent rather than throwing.
      const { count } = await tx.glossary.deleteMany({
        where: { id: held.id },
      });
      return count > 0 ? 'removed' : 'absent';
    });
  }

  async listItems(
    scope: LibraryScope,
    glossaryId: string,
  ): Promise<GlossaryItem[]> {
    // A glossary outside the scope simply yields an empty list.
    const glossary = await findHeld(this.prisma, scope, glossaryId);
    if (glossary === null) return [];

    const rows = await this.prisma.glossaryItem.findMany({
      where: { glossaryId: glossary.id },
      orderBy: { createdAt: 'asc' },
      select: ITEM_SELECT,
    });
    return rows.map((r) => toItem(r, glossaryId));
  }

  async addItem(
    scope: LibraryScope,
    glossaryId: string,
    body: SaveGlossaryItemRequest,
    maxPerGlossary: number,
  ): Promise<ItemAddResult> {
    return this.prisma.$transaction(async (tx) => {
      const glossary = await findHeld(tx, scope, glossaryId);
      if (glossary === null) return { kind: 'absent' } as const;
      if (!canEditRow(scope, glossary.ownerId)) {
        return { kind: 'forbidden' } as const;
      }

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
      if (existing !== null) {
        return { kind: 'saved', value: toItem(existing, glossaryId) } as const;
      }

      const itemCount = await tx.glossaryItem.count({
        where: { glossaryId: glossary.id },
      });
      if (itemCount >= maxPerGlossary) return { kind: 'limit' } as const;

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
      return { kind: 'saved', value: toItem(row, glossaryId) } as const;
    });
  }

  async removeItem(
    scope: LibraryScope,
    glossaryId: string,
    itemId: string,
  ): Promise<RemoveResult> {
    return this.prisma.$transaction(async (tx) => {
      const glossary = await findHeld(tx, scope, glossaryId);
      if (glossary === null) return 'absent';
      if (!canEditRow(scope, glossary.ownerId)) return 'forbidden';

      // `itemId` is the client-minted id the API hands out, not the row's own
      // primary key; `(glossaryId, clientId)` is unique, so this hits one row.
      const { count } = await tx.glossaryItem.deleteMany({
        where: { clientId: itemId, glossaryId: glossary.id },
      });
      return count > 0 ? 'removed' : 'absent';
    });
  }
}

/** Takes the scope's glossary lock, released by the transaction's COMMIT or ROLLBACK. */
async function lockScope(
  tx: Prisma.TransactionClient,
  scope: LibraryScope,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_CLASS.GLOSSARIES}::int, hashtext(${scopeLockKey(scope)}))`;
}

/** Whether any glossary in ANY scope already uses this client id. */
async function idInUse(
  tx: Prisma.TransactionClient,
  clientId: string,
): Promise<boolean> {
  const row = await tx.glossary.findFirst({
    where: { clientId },
    select: { id: true },
  });
  return row !== null;
}

/** The scope's glossary under this client id, or null — never a row of another scope. */
function findHeld(
  client: Prisma.TransactionClient,
  scope: LibraryScope,
  clientId: string,
): Promise<{ id: string; ownerId: string } | null> {
  return client.glossary.findFirst({
    where: { ...scopeWhere(scope), clientId },
    select: { id: true, ownerId: true },
  });
}

interface GlossaryRow {
  clientId: string;
  ownerId: string;
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
  ownerId: true,
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

/** `ownerId` is read only to compute `canEdit`; it is never returned. */
function toGlossary(row: GlossaryRow, scope: LibraryScope): Glossary {
  return {
    id: row.clientId,
    name: row.name,
    description: row.description,
    sourceLang: row.sourceLang as LanguageCode,
    isActive: row.isActive,
    itemCount: row._count.items,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(scope.kind === 'team'
      ? { canEdit: canEditRow(scope, row.ownerId) }
      : {}),
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

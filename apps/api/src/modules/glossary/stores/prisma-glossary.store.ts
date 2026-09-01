import { Injectable } from '@nestjs/common';
import type { GlossaryTerm, GlossaryTermRecord } from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DuplicateGlossaryTermError,
  type GlossaryImportMode,
  type GlossaryStore,
} from '../interfaces/glossary-store.interface';

/** The row shape a read returns — the columns {@link toRecord} maps. */
interface GlossaryRow {
  id: string;
  vi: string;
  en: string;
  keepVerbatim: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Postgres-backed glossary store — the durable seam behind GLOSSARY_STORE.
 *
 * Same contract as {@link MemoryGlossaryStore}, scoped by `ownerId` and made
 * unique on `(ownerId, vi, en)` by the table's compound key. Writes that would
 * violate that key are caught and re-raised as {@link DuplicateGlossaryTermError}
 * so the backend never leaks past the store. Owner scoping on update and delete
 * is enforced by filtering on `ownerId` in the same statement — an id belonging
 * to another user matches no row and resolves to null, never their term.
 */
@Injectable()
export class PrismaGlossaryStore implements GlossaryStore {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<GlossaryTermRecord[]> {
    const rows = await this.prisma.glossaryTerm.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async create(
    ownerId: string,
    term: GlossaryTerm,
  ): Promise<GlossaryTermRecord> {
    try {
      const row = await this.prisma.glossaryTerm.create({
        data: {
          ownerId,
          vi: term.vi,
          en: term.en,
          keepVerbatim: term.keepVerbatim,
        },
      });
      return toRecord(row);
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DuplicateGlossaryTermError(term.vi, term.en);
      throw err;
    }
  }

  async update(
    ownerId: string,
    id: string,
    patch: Partial<GlossaryTerm>,
  ): Promise<GlossaryTermRecord | null> {
    // Scope the write to the owner: `updateMany` filters on both id and ownerId,
    // so another user's id updates nothing. `update` (by unique id alone) would
    // not, which is the whole IDOR hole this avoids.
    try {
      const { count } = await this.prisma.glossaryTerm.updateMany({
        where: { id, ownerId },
        data: patch,
      });
      if (count === 0) return null;
    } catch (err) {
      if (isUniqueViolation(err)) {
        // The patch may omit a side; report the resulting pair for the message.
        const row = await this.prisma.glossaryTerm.findFirst({
          where: { id, ownerId },
        });
        throw new DuplicateGlossaryTermError(
          patch.vi ?? row?.vi ?? '',
          patch.en ?? row?.en ?? '',
        );
      }
      throw err;
    }
    const row = await this.prisma.glossaryTerm.findFirst({
      where: { id, ownerId },
    });
    return row ? toRecord(row) : null;
  }

  async remove(
    ownerId: string,
    id: string,
  ): Promise<GlossaryTermRecord | null> {
    const row = await this.prisma.glossaryTerm.findFirst({
      where: { id, ownerId },
    });
    if (!row) return null;
    await this.prisma.glossaryTerm.deleteMany({ where: { id, ownerId } });
    return toRecord(row);
  }

  async importTerms(
    ownerId: string,
    terms: readonly GlossaryTerm[],
    mode: GlossaryImportMode,
  ): Promise<GlossaryTermRecord[]> {
    await this.prisma.$transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.glossaryTerm.deleteMany({ where: { ownerId } });
      }
      for (const term of terms) {
        // Upsert on the compound key: an existing pair keeps its id and refreshes
        // keepVerbatim; a new pair is inserted. `replace` deleted first, so every
        // upsert there is an insert — but internal duplicates in one payload still
        // resolve to a single row rather than a constraint failure.
        await tx.glossaryTerm.upsert({
          where: { ownerId_vi_en: { ownerId, vi: term.vi, en: term.en } },
          create: {
            ownerId,
            vi: term.vi,
            en: term.en,
            keepVerbatim: term.keepVerbatim,
          },
          update: { keepVerbatim: term.keepVerbatim },
        });
      }
    });
    return this.list(ownerId);
  }
}

/** Map a persisted row to the wire record — never exposes ownerId. */
function toRecord(row: GlossaryRow): GlossaryTermRecord {
  return {
    id: row.id,
    vi: row.vi,
    en: row.en,
    keepVerbatim: row.keepVerbatim,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Reads a unique-constraint refusal out of a Prisma error. Matched STRUCTURALLY
 * (`code === 'P2002'`) rather than with `instanceof`, matching
 * prisma-user.repository.ts: the glossary has one unique constraint besides its
 * id, so any P2002 here is the `(ownerId, vi, en)` pair.
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'P2002';
}

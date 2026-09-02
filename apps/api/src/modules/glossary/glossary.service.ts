import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GLOSSARY_LIMITS,
  type CreateGlossaryTermRequest,
  type GlossaryTermRecord,
  type ImportGlossaryRequest,
  type UpdateGlossaryTermRequest,
} from '@chatofy/types';
import {
  DuplicateGlossaryTermError,
  GLOSSARY_STORE,
  type GlossaryStore,
} from './interfaces/glossary-store.interface';

/**
 * The caller's glossary: list, add, edit, delete, and bulk import.
 *
 * Every operation is scoped to `ownerId` — the authenticated caller's user id
 * from the verified token — which the store enforces. This service adds the two
 * policies that are not the store's job: the per-user size ceiling
 * ({@link GLOSSARY_LIMITS.MAX_TERMS}, so a glossary cannot grow past the per-turn
 * injection budget it is bound by) and the mapping of a duplicate-pair or
 * absent-term outcome onto the right HTTP status.
 */
@Injectable()
export class GlossaryService {
  constructor(@Inject(GLOSSARY_STORE) private readonly store: GlossaryStore) {}

  list(ownerId: string): Promise<GlossaryTermRecord[]> {
    return this.store.list(ownerId);
  }

  async create(
    ownerId: string,
    term: CreateGlossaryTermRequest,
  ): Promise<GlossaryTermRecord> {
    const current = await this.store.list(ownerId);
    if (current.length >= GLOSSARY_LIMITS.MAX_TERMS) {
      throw new ConflictException(
        `glossary is full (max ${GLOSSARY_LIMITS.MAX_TERMS} terms)`,
      );
    }
    try {
      return await this.store.create(ownerId, term);
    } catch (err) {
      throw asHttpError(err);
    }
  }

  async update(
    ownerId: string,
    id: string,
    patch: UpdateGlossaryTermRequest,
  ): Promise<GlossaryTermRecord> {
    let updated: GlossaryTermRecord | null;
    try {
      updated = await this.store.update(ownerId, id, patch);
    } catch (err) {
      throw asHttpError(err);
    }
    if (!updated) throw new NotFoundException(`no glossary term with id ${id}`);
    return updated;
  }

  async remove(ownerId: string, id: string): Promise<GlossaryTermRecord> {
    const removed = await this.store.remove(ownerId, id);
    if (!removed) throw new NotFoundException(`no glossary term with id ${id}`);
    return removed;
  }

  async import(
    ownerId: string,
    request: ImportGlossaryRequest,
  ): Promise<GlossaryTermRecord[]> {
    // A merge can push the total past the ceiling even though the payload alone
    // is within it (the schema caps the payload); a replace cannot, since it
    // starts from empty and the payload is already capped. Count only the pairs
    // a merge would actually ADD, so re-importing the same list is never refused.
    if (request.mode === 'merge') {
      const current = await this.store.list(ownerId);
      const have = new Set(current.map((t) => pairKey(t.vi, t.en)));
      const added = request.terms.filter(
        (t) => !have.has(pairKey(t.vi, t.en)),
      ).length;
      if (current.length + added > GLOSSARY_LIMITS.MAX_TERMS) {
        throw new ConflictException(
          `import would exceed the glossary ceiling of ${GLOSSARY_LIMITS.MAX_TERMS} terms`,
        );
      }
    }
    return this.store.importTerms(ownerId, request.terms, request.mode);
  }
}

/** A duplicate pair is a 409; anything else is left to become the honest 500. */
function asHttpError(err: unknown): unknown {
  if (err instanceof DuplicateGlossaryTermError) {
    return new ConflictException(err.message);
  }
  return err;
}

/** The same exact-pair identity the store's uniqueness uses. */
function pairKey(vi: string, en: string): string {
  return `${vi}\n${en}`;
}

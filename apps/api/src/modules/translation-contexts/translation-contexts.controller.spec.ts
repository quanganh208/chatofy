import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { Request } from 'express';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
  type TranslationContext,
} from '@chatofy/types';
import { TranslationContextsController } from './translation-contexts.controller';
import { TranslationContextsService } from './translation-contexts.service';
import { translationContextIdParamSchema } from './dto/translation-contexts.dto';
import type { TranslationContextStore } from './interfaces/translation-context-store.interface';

/**
 * The routes, driven through the REAL service over a two-owner fake store.
 *
 * The fake holds rows for more than one owner on purpose. A store double that
 * only ever knows about the caller cannot fail the ownership assertions — it
 * would answer correctly no matter which key the code used — so the interesting
 * case, a PUT for an id another account already holds, needs both accounts to
 * exist at once.
 *
 * The ceiling is the store's arithmetic now, so the double implements it: what
 * these cases prove is the ROUTE's half — that a refusal reaches the client as
 * 409 and that a replace at a full library does not trip it. Whether the count
 * and the insert are actually atomic is the db-e2e suite's claim, not one a
 * `Map` can make.
 */

const OTHER = 'owner-2';
const MINE = 'owner-1';

const req = { auth: { userId: MINE } } as unknown as Request;

const body: SaveTranslationContextRequest = {
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [{ vi: 'hội đồng phản biện', en: 'thesis defense committee' }],
  style: null,
};

/** A store keyed the way the real one is: by (ownerId, clientId). */
function fakeStore(seed: { ownerId: string; id: string; name: string }[] = []) {
  const rows = new Map<string, TranslationContext & { ownerId: string }>(
    seed.map((s) => [
      `${s.ownerId}::${s.id}`,
      {
        ownerId: s.ownerId,
        id: s.id,
        name: s.name,
        topic: null,
        hotwords: [],
        glossary: [],
        style: null,
        updatedAt: '2026-09-17T00:00:00.000Z',
      },
    ]),
  );

  const own = (ownerId: string) =>
    [...rows.values()].filter((r) => r.ownerId === ownerId);

  const store: TranslationContextStore = {
    async list(ownerId) {
      return own(ownerId).map(({ ownerId: _o, ...rest }) => rest);
    },
    async save(ownerId, contextId, saved, maxPerOwner) {
      const key = `${ownerId}::${contextId}`;
      // The ceiling as the real store applies it: counted against what the OWNER
      // holds, and only for a create — a replace adds no row, so refusing it
      // would make a full library uneditable. A double that refused every write
      // at the ceiling would pass the 409 case below and fail the user.
      if (!rows.has(key) && own(ownerId).length >= maxPerOwner) return null;
      const row = {
        ownerId,
        id: contextId,
        ...saved,
        updatedAt: '2026-09-17T12:00:00.000Z',
      };
      rows.set(key, row);
      const { ownerId: _o, ...rest } = row;
      return rest;
    },
    async remove(ownerId, contextId) {
      return rows.delete(`${ownerId}::${contextId}`);
    },
  };

  return { store, rows, own };
}

const makeController = (store: TranslationContextStore) =>
  new TranslationContextsController(new TranslationContextsService(store));

/** `MAX_CONTEXTS_PER_OWNER` rows already held by `MINE`. */
const fullLibrary = () =>
  Array.from({ length: CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER }, (_, i) => ({
    ownerId: MINE,
    id: `ctx-${i}`,
    name: `Context ${i}`,
  }));

describe('TranslationContextsController', () => {
  it("GET returns only the caller's contexts", async () => {
    const { store } = fakeStore([
      { ownerId: MINE, id: 'ctx-mine', name: 'Mine' },
      { ownerId: OTHER, id: 'ctx-theirs', name: 'Theirs' },
    ]);

    const result = await makeController(store).list(req);

    expect(result.contexts.map((c) => c.id)).toEqual(['ctx-mine']);
  });

  it('PUT for an id owned by another account creates a NEW row for the caller and never touches theirs', async () => {
    // The `(ownerId, clientId)` scoping is what makes this a create rather than
    // an overwrite or a unique violation: a guessed id resolves to nothing for
    // the caller, so the two rows coexist and neither account learns of the
    // other.
    const { store, rows } = fakeStore([
      { ownerId: OTHER, id: 'ctx-shared', name: 'Theirs' },
    ]);

    await makeController(store).save(req, { contextId: 'ctx-shared' }, body);

    expect(rows.get(`${OTHER}::ctx-shared`)?.name).toBe('Theirs');
    expect(rows.get(`${MINE}::ctx-shared`)?.name).toBe('Thesis defense');
  });

  it('refuses the 21st create with 409', async () => {
    const { store } = fakeStore(fullLibrary());

    await expect(
      makeController(store).save(req, { contextId: 'ctx-new' }, body),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows a replace of an existing context even at the ceiling', async () => {
    // Otherwise a full library is permanently uneditable: the user could neither
    // add to it nor fix what is in it.
    const { store, rows } = fakeStore(fullLibrary());

    await makeController(store).save(req, { contextId: 'ctx-0' }, body);

    expect(rows.get(`${MINE}::ctx-0`)?.name).toBe('Thesis defense');
    expect(rows.size).toBe(CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER);
  });

  it('DELETE answers 204 for an id that was never there', async () => {
    const { store } = fakeStore();
    await expect(
      makeController(store).remove(req, { contextId: 'ctx-absent' }),
    ).resolves.toBeUndefined();
  });

  it('refuses a non-uuid contextId at the boundary', async () => {
    // The 400 is the pipe's, not the handler's: the value goes into a btree
    // unique index, and an unvalidated multi-kilobyte id is a 500 where a 400
    // belongs.
    expect(
      translationContextIdParamSchema.safeParse({ contextId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      translationContextIdParamSchema.safeParse({
        contextId: '6f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
      }).success,
    ).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
} from '@chatofy/types';
import { TranslationContextsService } from './translation-contexts.service';
import type { TranslationContextStore } from './interfaces/translation-context-store.interface';

/**
 * The ceiling arithmetic and the count-then-decide ordering, apart from HTTP.
 *
 * Asserted on the CALLS rather than on the outcome: "the list was not read below
 * the ceiling" is a statement about cost that no return value can carry, and it
 * is the half of the rule that keeps the common path one query.
 */

const body: SaveTranslationContextRequest = {
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
};

const context = (id: string) => ({
  id,
  name: id,
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  updatedAt: '2026-09-17T00:00:00.000Z',
});

function makeService(held: string[]) {
  const count = vi.fn().mockResolvedValue(held.length);
  const list = vi.fn().mockResolvedValue(held.map(context));
  const save = vi.fn(async (_o: string, id: string) => context(id));
  const remove = vi.fn().mockResolvedValue(true);
  const store = {
    count,
    list,
    save,
    remove,
  } as unknown as TranslationContextStore;
  return {
    service: new TranslationContextsService(store),
    count,
    list,
    save,
    remove,
  };
}

const atCeiling = Array.from(
  { length: CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER },
  (_, i) => `ctx-${i}`,
);

describe('TranslationContextsService', () => {
  it('counts before deciding, and does not read the list below the ceiling', async () => {
    const { service, count, list, save } = makeService(['ctx-0']);

    await service.save('owner-1', 'ctx-new', body);

    expect(count).toHaveBeenCalledWith('owner-1');
    expect(list).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('owner-1', 'ctx-new', body);
  });

  it('refuses a create once the account holds the maximum', async () => {
    const { service, save } = makeService(atCeiling);

    await expect(
      service.save('owner-1', 'ctx-new', body),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(save).not.toHaveBeenCalled();
  });

  it('allows a replace at the ceiling, reading the list to tell the two apart', async () => {
    const { service, list, save } = makeService(atCeiling);

    await service.save('owner-1', 'ctx-3', body);

    expect(list).toHaveBeenCalledWith('owner-1');
    expect(save).toHaveBeenCalledWith('owner-1', 'ctx-3', body);
  });

  it('discards whether a delete removed anything', async () => {
    // The route is 204 either way, so an id that was never there and one
    // belonging to someone else are indistinguishable to the caller.
    const { service, remove } = makeService([]);
    remove.mockResolvedValue(false);

    await expect(
      service.remove('owner-1', 'ctx-absent'),
    ).resolves.toBeUndefined();
  });
});

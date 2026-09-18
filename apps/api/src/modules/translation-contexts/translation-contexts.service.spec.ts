import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
  type TranslationContext,
} from '@chatofy/types';
import { TranslationContextsService } from './translation-contexts.service';
import type { TranslationContextStore } from './interfaces/translation-context-store.interface';

/**
 * The half of the ceiling this service still decides, apart from HTTP.
 *
 * The arithmetic is the store's now — only it can count and insert in one
 * transaction — so there is nothing left here to assert about 19 versus 20. What
 * is left is the number the store is HELD to and what a refusal reads as, and
 * both of those are asserted on the call and on the exception rather than on a
 * double that would just be agreeing with itself.
 *
 * The case that the service reads NOTHING before the save is the one that keeps
 * the fix in place: a count taken out here is the read that let two concurrent
 * creates both pass, and re-adding one would look harmless.
 */

const body: SaveTranslationContextRequest = {
  name: 'Thesis defense',
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
};

const context = (id: string): TranslationContext => ({
  id,
  name: id,
  topic: null,
  hotwords: [],
  glossary: [],
  style: null,
  updatedAt: '2026-09-17T00:00:00.000Z',
});

/** A store that writes whatever it is given, unless `refuse` is set. */
function makeService(options: { refuse?: boolean } = {}) {
  const list = vi.fn().mockResolvedValue([]);
  const save = vi.fn(async (_owner: string, id: string) =>
    options.refuse === true ? null : context(id),
  );
  const remove = vi.fn().mockResolvedValue(true);
  const store = { list, save, remove } as unknown as TranslationContextStore;
  return {
    service: new TranslationContextsService(store),
    list,
    save,
    remove,
  };
}

describe('TranslationContextsService', () => {
  it('holds the store to the ceiling the contract states', async () => {
    const { service, save } = makeService();

    await service.save('owner-1', 'ctx-new', body);

    expect(save).toHaveBeenCalledWith(
      'owner-1',
      'ctx-new',
      body,
      CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER,
    );
  });

  it('reads nothing of its own before the save', async () => {
    // The whole reason the ceiling moved into the store's transaction. A count
    // or a list taken here is a read with nothing holding it, and two creates
    // fired together would both be told there is room.
    const { service, list, save } = makeService();

    await service.save('owner-1', 'ctx-new', body);

    expect(list).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('turns a refused write into a 409 naming the ceiling', async () => {
    const { service } = makeService({ refuse: true });

    const refusal = service.save('owner-1', 'ctx-new', body);

    await expect(refusal).rejects.toBeInstanceOf(ConflictException);
    // The number reaches the user, so it has to come from the contract rather
    // than be written into the sentence by hand.
    await expect(refusal).rejects.toThrow(
      String(CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER),
    );
  });

  it('returns the written context untouched when the store wrote one', async () => {
    // Nothing is re-checked on top of the store's answer: a second gate here
    // would refuse a replace the store already decided was legal.
    const { service } = makeService();

    await expect(service.save('owner-1', 'ctx-3', body)).resolves.toEqual(
      context('ctx-3'),
    );
  });

  it('discards whether a delete removed anything', async () => {
    // The route is 204 either way, so an id that was never there and one
    // belonging to someone else are indistinguishable to the caller.
    const { service, remove } = makeService();
    remove.mockResolvedValue(false);

    await expect(
      service.remove('owner-1', 'ctx-absent'),
    ).resolves.toBeUndefined();
  });
});

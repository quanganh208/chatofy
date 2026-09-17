import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SaveTranslationContextRequest } from '@chatofy/types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PrismaTranslationContextStore } from './prisma-translation-context.store';

/**
 * The ownership scoping, and the replace.
 *
 * These assert by INSPECTING THE ARGUMENTS rather than by round-tripping data:
 * a store that dropped the owner from a `where` would still pass a "returns the
 * row" test against a fake that answers unconditionally. The compound
 * `ownerId_clientId` key is what makes omitting the owner not compile, and these
 * are what prove it is actually the key being used.
 */

/** A row shaped as the store's own select asks for it. */
const row = (over: Record<string, unknown> = {}) => ({
  clientId: 'ctx-1',
  name: 'Thesis defense',
  topic: 'thesis defense committee meeting',
  hotwords: ['VinFast'],
  style: 'formal',
  updatedAt: new Date('2026-09-17T00:00:00.000Z'),
  glossary: [{ vi: 'hội đồng phản biện', en: 'thesis defense committee' }],
  ...over,
});

const body: SaveTranslationContextRequest = {
  name: 'Thesis defense',
  topic: 'thesis defense committee meeting',
  hotwords: ['VinFast'],
  glossary: [
    { vi: 'hội đồng phản biện', en: 'thesis defense committee' },
    { vi: 'luận văn', en: 'thesis' },
  ],
  style: 'formal',
};

/**
 * A fake Prisma whose `$transaction` records the ORDER of the calls made inside
 * it, which is the only way to see that the delete precedes the insert.
 */
function fakePrisma(options: { transaction?: Mock } = {}) {
  const calls: string[] = [];
  const upsert = vi.fn(async () => {
    calls.push('upsert');
    return { id: 'cuid-1' };
  });
  const deleteMany = vi.fn(async () => {
    calls.push('glossary.deleteMany');
    return { count: 1 };
  });
  const createMany = vi.fn(async () => {
    calls.push('glossary.createMany');
    return { count: 2 };
  });
  const findUniqueOrThrow = vi.fn(async () => row());
  const findMany = vi.fn(async () => [row()]);
  const count = vi.fn(async () => 3);
  const contextDeleteMany = vi.fn(async () => ({ count: 1 }));

  const tx = {
    translationContext: { upsert, findUniqueOrThrow },
    glossaryTerm: { deleteMany, createMany },
  };

  const prisma = {
    translationContext: { findMany, count, deleteMany: contextDeleteMany },
    $transaction:
      options.transaction ??
      vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  return {
    store: new PrismaTranslationContextStore(prisma),
    calls,
    upsert,
    deleteMany,
    createMany,
    findMany,
    count,
    contextDeleteMany,
    transaction: (prisma as unknown as { $transaction: Mock }).$transaction,
  };
}

describe('PrismaTranslationContextStore', () => {
  it('scopes the list query by ownerId', async () => {
    const { store, findMany } = fakePrisma();
    await store.list('owner-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'owner-1' } }),
    );
  });

  it('addresses the row by ownerId_clientId on save', async () => {
    const { store, upsert } = fakePrisma();
    await store.save('owner-1', 'ctx-1', body);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId_clientId: { ownerId: 'owner-1', clientId: 'ctx-1' } },
      }),
    );
  });

  it('addresses the row by ownerId and clientId on delete', async () => {
    const { store, contextDeleteMany } = fakePrisma();
    await store.remove('owner-1', 'ctx-1');
    expect(contextDeleteMany).toHaveBeenCalledWith({
      where: { ownerId: 'owner-1', clientId: 'ctx-1' },
    });
  });

  it('replaces the glossary rather than appending, inside one transaction', async () => {
    const { store, calls, transaction } = fakePrisma();
    await store.save('owner-1', 'ctx-1', body);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('glossary.deleteMany')).toBeLessThan(
      calls.indexOf('glossary.createMany'),
    );
  });

  it('takes glossary positions from the array index', async () => {
    const { store, createMany } = fakePrisma();
    await store.save('owner-1', 'ctx-1', body);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          contextId: 'cuid-1',
          position: 0,
          vi: 'hội đồng phản biện',
          en: 'thesis defense committee',
        },
        { contextId: 'cuid-1', position: 1, vi: 'luận văn', en: 'thesis' },
      ],
    });
  });

  it('retries a serialization conflict and then surfaces it', async () => {
    const conflict = Object.assign(new Error('serialization failure'), {
      code: 'P2034',
    });
    const transaction = vi.fn(async () => {
      throw conflict;
    });
    const { store } = fakePrisma({ transaction });
    await expect(store.save('owner-1', 'ctx-1', body)).rejects.toBe(conflict);
    // Bounded: three attempts, then the conflict reaches the caller rather than
    // being retried forever against a conflict a retry cannot resolve.
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});

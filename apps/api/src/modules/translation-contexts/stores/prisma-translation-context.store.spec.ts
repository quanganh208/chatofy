import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SaveTranslationContextRequest } from '@chatofy/types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PrismaTranslationContextStore } from './prisma-translation-context.store';

/**
 * The ownership scoping, the replace, and where the ceiling is counted.
 *
 * These assert by INSPECTING THE ARGUMENTS rather than by round-tripping data:
 * a store that dropped the owner from a `where` would still pass a "returns the
 * row" test against a fake that answers unconditionally. The compound
 * `ownerId_clientId` key is what makes omitting the owner not compile, and these
 * are what prove it is actually the key being used.
 *
 * The ceiling cases assert on the recorded call ORDER for the same reason: that
 * the count happens at all is not the point — a count before the transaction
 * would satisfy any assertion about its result — the point is that it happens
 * inside the one the write runs in. Whether Postgres then really serialises the
 * pair is a claim no fake can make, and the db-e2e suite measures it.
 */

/** The ceiling these cases hold the store to. Not the product's number. */
const MAX = 4;

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
 * it, which is the only way to see that the delete precedes the insert and that
 * the count precedes the write.
 *
 * `held` is what the owner already has: how many rows, and whether one of them
 * is the id being saved.
 */
function fakePrisma(
  options: { transaction?: Mock; held?: number; exists?: boolean } = {},
) {
  const calls: string[] = [];
  const findUnique = vi.fn(async () => {
    calls.push('findUnique');
    return options.exists === false ? null : { id: 'cuid-1' };
  });
  const count = vi.fn(async () => {
    calls.push('count');
    return options.held ?? 0;
  });
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
  const contextDeleteMany = vi.fn(async () => ({ count: 1 }));

  const tx = {
    translationContext: { findUnique, count, upsert, findUniqueOrThrow },
    glossaryTerm: { deleteMany, createMany },
  };

  const prisma = {
    translationContext: { findMany, deleteMany: contextDeleteMany },
    $transaction:
      options.transaction ??
      vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  return {
    store: new PrismaTranslationContextStore(prisma),
    calls,
    findUnique,
    count,
    upsert,
    deleteMany,
    createMany,
    findMany,
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
    await store.save('owner-1', 'ctx-1', body, MAX);
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
    await store.save('owner-1', 'ctx-1', body, MAX);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('glossary.deleteMany')).toBeLessThan(
      calls.indexOf('glossary.createMany'),
    );
  });

  it('takes glossary positions from the array index', async () => {
    const { store, createMany } = fakePrisma();
    await store.save('owner-1', 'ctx-1', body, MAX);
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

  describe('the per-owner ceiling', () => {
    it('refuses a create once the owner holds the maximum, writing nothing', async () => {
      const { store, upsert, createMany } = fakePrisma({
        exists: false,
        held: MAX,
      });

      // `null` and not a throw: what a breached ceiling means to a caller is the
      // service's to say, and a store that threw `ConflictException` would put
      // the status code in the persistence layer.
      await expect(store.save('owner-1', 'ctx-new', body, MAX)).resolves.toBe(
        null,
      );
      expect(upsert).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
    });

    it('counts inside the transaction that writes, and before it writes', async () => {
      // The whole of the fix. A count taken before the transaction is a read
      // with nothing holding it: two creates fired together one short of the
      // ceiling both see room and both commit. Inside it, the count's predicate
      // lock over the owner's rows conflicts with the other insert and Postgres
      // aborts one of the pair.
      const { store, calls, transaction } = fakePrisma({
        exists: false,
        held: MAX - 1,
      });

      await store.save('owner-1', 'ctx-new', body, MAX);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(calls.indexOf('count')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('count')).toBeLessThan(calls.indexOf('upsert'));
    });

    it('scopes the count to the owner', async () => {
      const { store, count } = fakePrisma({ exists: false, held: 0 });
      await store.save('owner-1', 'ctx-new', body, MAX);
      expect(count).toHaveBeenCalledWith({ where: { ownerId: 'owner-1' } });
    });

    it('allows a replace at the ceiling without counting at all', async () => {
      // A replace adds no row, so it is never refused — a ceiling applied to
      // every write would make a full library permanently uneditable. Skipping
      // the count is also what keeps two replaces from serialising against each
      // other: no count, no predicate lock over the owner's range.
      const { store, count, upsert } = fakePrisma({ exists: true, held: MAX });

      const saved = await store.save('owner-1', 'ctx-1', body, MAX);

      expect(saved).not.toBe(null);
      expect(count).not.toHaveBeenCalled();
      expect(upsert).toHaveBeenCalledTimes(1);
    });
  });

  it('retries a serialization conflict and then surfaces it', async () => {
    // The shape Postgres produces when it aborts a STATEMENT inside the
    // transaction: Prisma wraps it as its own error with a `code` and no cause.
    const conflict = Object.assign(new Error('serialization failure'), {
      code: 'P2034',
    });
    const transaction = vi.fn(async () => {
      throw conflict;
    });
    const { store } = fakePrisma({ transaction });
    await expect(store.save('owner-1', 'ctx-1', body, MAX)).rejects.toBe(
      conflict,
    );
    // Bounded: five attempts, then the conflict reaches the caller rather than
    // being retried forever against a conflict a retry cannot resolve. Five
    // rather than three because a conflict was once seen exhausting three and
    // reaching a caller as a 500; the extra headroom costs nothing on a path
    // where a conflict arises about twice in thirty runs.
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('recognises a serialization conflict wrapped by the driver adapter', async () => {
    // The shape Postgres produces when it aborts at COMMIT instead, which is the
    // one this route actually hits: `@prisma/adapter-pg` throws a
    // `DriverAdapterError` carrying no `code` of its own, and its `cause` is a
    // PLAIN OBJECT rather than an `Error` — copied from the real thing, because
    // a double that made the cause an `Error` would pass a check that reading
    // `err.cause.code` would also pass, and the real field is `originalCode`.
    // Matching on `err.code` alone read this as permanent and answered 500 where
    // a retry belonged, on 19 of 20 concurrent save pairs.
    const wrapped = Object.assign(new Error('TransactionWriteConflict'), {
      cause: {
        originalCode: '40001',
        originalMessage:
          'could not serialize access due to read/write dependencies among transactions',
        kind: 'TransactionWriteConflict',
      },
    });
    const transaction = vi.fn(async () => {
      throw wrapped;
    });
    const { store } = fakePrisma({ transaction });

    await expect(store.save('owner-1', 'ctx-1', body, MAX)).rejects.toBe(
      wrapped,
    );
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('does not retry a conflict a retry cannot resolve', async () => {
    // A unique violation is not transient: re-running the identical body hits
    // the identical constraint, so the retry would only spend two more
    // SERIALIZABLE transactions before failing anyway.
    const permanent = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
    });
    const transaction = vi.fn(async () => {
      throw permanent;
    });
    const { store } = fakePrisma({ transaction });

    await expect(store.save('owner-1', 'ctx-1', body, MAX)).rejects.toBe(
      permanent,
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

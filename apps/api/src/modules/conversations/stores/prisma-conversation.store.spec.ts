import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PrismaConversationStore } from './prisma-conversation.store';
import type { ConversationWrite } from '../interfaces/conversation-store.interface';

/**
 * The per-owner lock the replace takes, and the bounded retry around it.
 *
 * The retry is asserted on the ATTEMPT COUNT rather than on the outcome, because
 * a retry that fires once and a retry that fires three times both end in a saved
 * conversation, and only one of them is the policy this loop is written to. The
 * errors thrown at it are copied from own-property dumps of the real ones: the
 * conflict arrives in two shapes depending on where Postgres notices it, and a
 * predicate that handles only the first looks correct in every log.
 */

/** A save body shaped as the store's own parameter type asks for it. */
const conversation: ConversationWrite = {
  languages: ['vi', 'en'],
  startedAt: '2026-09-17T00:00:00.000Z',
  endedAt: '2026-09-17T00:01:00.000Z',
  audioOffsetMs: null,
  turns: [
    {
      position: 0,
      speakerRole: 'speaker_a',
      speakerLabel: null,
      sourceText: 'xin chào',
      displayText: null,
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
      offsetMs: 0,
    },
  ],
};

/**
 * Aborted on a STATEMENT inside the transaction, which is what a route usually
 * hits: Prisma's own error, with a `code` and no cause at all.
 */
function statementConflict(): Error {
  return Object.assign(
    new Error('Transaction failed due to a write conflict'),
    {
      code: 'P2034',
    },
  );
}

/**
 * Aborted at COMMIT: `@prisma/adapter-pg` throws a `DriverAdapterError` carrying
 * no `code` whatever, whose `cause` is a PLAIN OBJECT — not an `Error` — holding
 * the SQLSTATE under `originalCode`.
 *
 * Every one of those details is load-bearing, and {@link assertRealCommitShape}
 * holds this double to them. A double written with an `Error` cause, or with the
 * code under `cause.code`, passes the naive guard that let this conflict through
 * in the first place — it would certify the bug rather than catch it.
 */
function commitConflict(): Error {
  return Object.assign(new Error('TransactionWriteConflict'), {
    cause: {
      originalCode: '40001',
      originalMessage:
        'could not serialize access due to read/write dependencies among transactions',
      kind: 'TransactionWriteConflict',
    },
  });
}

function assertRealCommitShape(err: Error & { cause?: unknown }): void {
  expect(err).not.toHaveProperty('code');
  expect(err.cause).not.toBeInstanceOf(Error);
  expect(err.cause).not.toHaveProperty('code');
  expect(Object.getPrototypeOf(err.cause)).toBe(Object.prototype);
}

/**
 * A fake Prisma whose `$transaction` can be made to fail a given number of times
 * before it runs the store's body.
 *
 * `failures` defaults to "every time" when an error is supplied, which is what
 * proves the budget is bounded rather than merely that a retry happens.
 */
function fakePrisma(options: { failWith?: unknown; failures?: number } = {}) {
  // The order the transaction issues its statements in, which is what the lock
  // assertions below are really about.
  const calls: string[] = [];
  const upsert = vi.fn(async () => {
    calls.push('conversation.upsert');
    return { id: 'cuid-1', minutes: null };
  });
  const deleteMany = vi.fn(async () => {
    calls.push('turn.deleteMany');
    return { count: 0 };
  });
  const createMany = vi.fn(async () => {
    calls.push('turn.createMany');
    return { count: 1 };
  });
  const locks: { sql: string; values: unknown[] }[] = [];
  const executeRaw = vi.fn(
    async (template: TemplateStringsArray, ...values: unknown[]) => {
      calls.push('advisoryLock');
      locks.push({ sql: template.join('?'), values });
      return 1;
    },
  );

  const tx = {
    $executeRaw: executeRaw,
    conversation: { upsert },
    conversationTurn: { deleteMany, createMany },
  };

  const budget =
    options.failures ?? (options.failWith === undefined ? 0 : Infinity);
  let failed = 0;
  const settings: unknown[] = [];
  const transaction = vi.fn(
    async (run: (client: typeof tx) => unknown, txOptions?: unknown) => {
      settings.push(txOptions);
      if (failed < budget) {
        failed += 1;
        throw options.failWith;
      }
      return run(tx);
    },
  );

  const prisma = { $transaction: transaction } as unknown as PrismaService;

  return {
    store: new PrismaConversationStore(prisma),
    calls,
    locks,
    settings,
    executeRaw,
    upsert,
    deleteMany,
    createMany,
    transaction: transaction as Mock,
  };
}

describe('PrismaConversationStore', () => {
  it('saves in one transaction when nothing conflicts', async () => {
    const { store, transaction, createMany } = fakePrisma();

    const saved = await store.save('owner-1', 'conv-1', conversation);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(saved).toEqual({
      conversationId: 'conv-1',
      direction: 'vi_to_en',
      languages: ['vi', 'en'],
      startedAt: '2026-09-17T00:00:00.000Z',
      endedAt: '2026-09-17T00:01:00.000Z',
      turnCount: 1,
      preview: 'xin chào',
      hasMinutes: false,
    });
  });

  it('addresses the row by ownerId_clientId on save', async () => {
    const { store, upsert } = fakePrisma();

    await store.save('owner-1', 'conv-1', conversation);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId_clientId: { ownerId: 'owner-1', clientId: 'conv-1' } },
      }),
    );
  });

  it('locks the owner before the upsert probes for the row', async () => {
    // Asserted on the ORDER, because a lock taken after the upsert would satisfy
    // any assertion that it was taken at all and would still leave open the
    // window it exists to close: Prisma compiles this upsert to a probe SELECT
    // followed by an INSERT, so two saves of a conversation that does not exist
    // yet both probe, both insert, and the loser gets a unique violation on
    // `@@unique([ownerId, clientId])` that no retry can resolve.
    const { store, calls, executeRaw } = fakePrisma();

    await store.save('owner-1', 'conv-1', conversation);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'advisoryLock',
      'conversation.upsert',
      'turn.deleteMany',
      'turn.createMany',
    ]);
  });

  it('runs the replace at READ COMMITTED, not SERIALIZABLE', async () => {
    // Load-bearing and invisible from the call site. SERIALIZABLE conflicts
    // table-wide on this transaction — it was cancelling saves that shared no
    // row and no owner — and the lock above only orders saves that share an
    // OWNER, so restoring the level here would restore the aborts the lock
    // cannot absorb.
    const { store, settings } = fakePrisma();

    await store.save('owner-1', 'conv-1', conversation);

    expect(settings[0]).toEqual(
      expect.objectContaining({ isolationLevel: 'ReadCommitted' }),
    );
  });

  it('keys the lock on the owner, under this module own class', async () => {
    // Transaction-scoped, because Prisma returns connections to a pool and a
    // session-scoped lock could be released on a different connection than took
    // it. Two ints rather than one bigint: the first names this module, so
    // another feature's lock cannot collide with one taken here. Postgres does
    // the hashing, so the key cannot drift from the owner id.
    const { store, locks } = fakePrisma();

    await store.save('owner-1', 'conv-1', conversation);

    expect(locks[0]?.sql).toContain('pg_advisory_xact_lock');
    expect(locks[0]?.sql).not.toContain('pg_advisory_lock(');
    expect(locks[0]?.sql).toContain('hashtext');
    expect(locks[0]?.values[1]).toBe('owner-1');
  });

  describe('the retry around a transient conflict', () => {
    it('re-runs a conflict Postgres reported on a statement, then surfaces it', async () => {
      const conflict = statementConflict();
      const { store, transaction } = fakePrisma({ failWith: conflict });

      await expect(store.save('owner-1', 'conv-1', conversation)).rejects.toBe(
        conflict,
      );
      // Bounded: three attempts and then the caller hears about it, rather than
      // a loop that never ends against a conflict re-running cannot resolve.
      expect(transaction).toHaveBeenCalledTimes(3);
    });

    it('re-runs a conflict the driver adapter wrapped at commit', async () => {
      // The shape that reaches this store with no `code` at all. Matching on
      // `err.code` alone read it as permanent, so the retry beside the replace
      // never fired and a transient abort reached the client as a 500.
      const conflict = commitConflict();
      assertRealCommitShape(conflict);
      const { store, transaction } = fakePrisma({ failWith: conflict });

      await expect(store.save('owner-1', 'conv-1', conversation)).rejects.toBe(
        conflict,
      );
      expect(transaction).toHaveBeenCalledTimes(3);
    });

    it('writes on the attempt after a conflict clears, and only that attempt', async () => {
      // A retry is worth nothing if the re-attempt does not carry the write. The
      // failed attempt threw before the body ran, so exactly one createMany is
      // the proof that the conversation was saved once rather than twice.
      const conflict = commitConflict();
      const { store, transaction, createMany } = fakePrisma({
        failWith: conflict,
        failures: 1,
      });

      const saved = await store.save('owner-1', 'conv-1', conversation);

      expect(transaction).toHaveBeenCalledTimes(2);
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(saved.conversationId).toBe('conv-1');
    });

    it('does not re-run a unique violation', async () => {
      // Not transient: re-running the identical body hits the identical
      // constraint, so the retry would only spend two more transactions, and log
      // two misleading conflict warnings, before failing exactly as it did the
      // first time.
      const permanent = Object.assign(new Error('unique constraint'), {
        code: 'P2002',
      });
      const { store, transaction } = fakePrisma({ failWith: permanent });

      await expect(store.save('owner-1', 'conv-1', conversation)).rejects.toBe(
        permanent,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('does not re-run a failure carrying no conflict code at all', async () => {
      const unrelated = new Error('connection terminated unexpectedly');
      const { store, transaction } = fakePrisma({ failWith: unrelated });

      await expect(store.save('owner-1', 'conv-1', conversation)).rejects.toBe(
        unrelated,
      );
      expect(transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    /** A row shaped the way `list`'s own `select` asks for it. */
    const row = (over: Record<string, unknown> = {}) => ({
      id: 'cuid-1',
      clientId: 'conv-1',
      languages: ['vi', 'en'],
      startedAt: new Date('2026-09-17T00:00:00.000Z'),
      endedAt: new Date('2026-09-17T00:01:00.000Z'),
      minutes: null,
      _count: { turns: 1 },
      turns: [{ sourceText: 'xin chào', displayText: null }],
      ...over,
    });

    function storeListing(rows: unknown[]) {
      const findMany = vi.fn().mockResolvedValue(rows);
      const prisma = {
        conversation: { findMany },
      } as unknown as PrismaService;
      return new PrismaConversationStore(prisma);
    }

    it('drops a row whose languages column cannot yield a direction, keeping the rest', async () => {
      // `legacyDirectionOf` throws on fewer than two codes — a shape the write
      // side never stores, so reaching it here means the row is corrupt, not
      // that the request is wrong. One such row must cost its own card, not
      // the whole list.
      const store = storeListing([
        row({
          id: 'cuid-corrupt',
          clientId: 'conv-corrupt',
          languages: ['vi'],
        }),
        row(),
      ]);

      const page = await store.list('owner-1', { limit: 30 });

      expect(page.conversations).toHaveLength(1);
      expect(page.conversations[0]?.conversationId).toBe('conv-1');
    });

    it('drops a row naming a language this registry does not know, keeping the rest', async () => {
      // A code added, written under, then rolled back: two codes, so the
      // direction would concatenate happily, but the client's page schema
      // rejects the whole page over one unknown enum value.
      const store = storeListing([
        row({
          id: 'cuid-orphan',
          clientId: 'conv-orphan',
          languages: ['ja', 'en'],
        }),
        row(),
      ]);

      const page = await store.list('owner-1', { limit: 30 });

      expect(page.conversations.map((c) => c.conversationId)).toEqual([
        'conv-1',
      ]);
    });

    it('lists every row when none are corrupt', async () => {
      const store = storeListing([
        row(),
        row({ id: 'cuid-2', clientId: 'conv-2' }),
      ]);

      const page = await store.list('owner-1', { limit: 30 });

      expect(page.conversations).toHaveLength(2);
    });
  });

  describe('get', () => {
    /** A turn row shaped the way `get`'s own `select` asks for it. */
    const turn = (over: Record<string, unknown> = {}) => ({
      position: 0,
      speakerRole: 'speaker_a',
      speakerLabel: null,
      sourceText: 'xin chào',
      displayText: null,
      sourceLanguages: ['vi'],
      translations: { en: 'hello' },
      offsetMs: 0,
      ...over,
    });

    const row = (over: Record<string, unknown> = {}) => ({
      clientId: 'conv-1',
      languages: ['vi', 'en'],
      startedAt: new Date('2026-09-17T00:00:00.000Z'),
      endedAt: new Date('2026-09-17T00:01:00.000Z'),
      audioOffsetMs: null,
      audioDurationMs: null,
      minutes: null,
      turns: [turn()],
      ...over,
    });

    function storeGetting(found: unknown) {
      const findUnique = vi.fn().mockResolvedValue(found);
      const prisma = {
        conversation: { findUnique },
      } as unknown as PrismaService;
      return new PrismaConversationStore(prisma);
    }

    it('answers not-found for a languages column the list would drop', async () => {
      // The same corrupt row must not be a dropped card on one route and a
      // 500 on the other.
      await expect(
        storeGetting(row({ languages: ['vi'] })).get('owner-1', 'conv-1'),
      ).resolves.toBeNull();
    });

    it('answers not-found for a conversation naming an unknown language', async () => {
      await expect(
        storeGetting(row({ languages: ['ja', 'en'] })).get('owner-1', 'conv-1'),
      ).resolves.toBeNull();
    });

    it('drops translation keys this registry does not know, keeping the rest', async () => {
      const conversation = await storeGetting(
        row({
          turns: [turn({ translations: { en: 'hello', ja: 'こんにちは' } })],
        }),
      ).get('owner-1', 'conv-1');

      expect(conversation?.turns[0]?.translations).toEqual({ en: 'hello' });
      expect(conversation?.turns[0]?.targetText).toBe('hello');
    });

    it('drops only the turn whose source language cannot be read', async () => {
      const conversation = await storeGetting(
        row({
          turns: [
            turn({ position: 0, sourceLanguages: ['ja'], translations: {} }),
            turn({ position: 1 }),
          ],
        }),
      ).get('owner-1', 'conv-1');

      expect(conversation?.turns.map((t) => t.position)).toEqual([1]);
      expect(conversation?.turnCount).toBe(1);
    });

    it('reads a well-formed conversation through unchanged', async () => {
      const conversation = await storeGetting(row()).get('owner-1', 'conv-1');

      expect(conversation?.languages).toEqual(['vi', 'en']);
      expect(conversation?.direction).toBe('vi_to_en');
      expect(conversation?.turns[0]).toMatchObject({
        sourceLanguages: ['vi'],
        translations: { en: 'hello' },
        targetText: 'hello',
      });
    });
  });
});

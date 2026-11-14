import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
} from '@chatofy/types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PrismaTranslationContextStore } from './prisma-translation-context.store';
import {
  mintTeamScope,
  personalScope,
} from '../../../common/library-scope/library-scope';

/** The personal scope every case runs in unless it says otherwise. */
const ME = personalScope('owner-1');

/**
 * The ownership scoping, the replace, and where the ceiling is counted.
 *
 * These assert by INSPECTING THE ARGUMENTS rather than by round-tripping data:
 * a store that dropped the scope from a `where` would still pass a "returns the
 * row" test against a fake that answers unconditionally. A personal `where`
 * must carry `teamId: null` as well as the owner, and these are what prove it
 * does.
 *
 * The ceiling cases assert on the recorded call ORDER for the same reason: that
 * the count happens at all is not the point — a count before the transaction
 * would satisfy any assertion about its result — the point is that it happens
 * inside the one the write runs in. Whether Postgres then really serialises the
 * pair is a claim no fake can make, and the db-e2e suite measures it.
 */

/** The ceiling these cases hold the store to. Not the product's number. */
const MAX = 4;

/** The linked glossary's client id, as the request and the response carry it. */
const GLOSSARY_CLIENT_ID = '5b0c1f9e-3d2a-4c7b-9e1f-0a6d2c8b4e71';

/** A row shaped as the store's own select asks for it. */
const row = (over: Record<string, unknown> = {}) => ({
  clientId: 'ctx-1',
  name: 'Thesis defense',
  topic: 'thesis defense committee meeting',
  hotwords: ['VinFast'],
  style: 'formal',
  updatedAt: new Date('2026-09-17T00:00:00.000Z'),
  glossary: [
    { terms: { vi: 'hội đồng phản biện', en: 'thesis defense committee' } },
  ],
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
  glossaryId: null,
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
  options: {
    transaction?: Mock;
    held?: number;
    exists?: boolean;
    /** Rows `list()` reads back. Defaults to one valid row. */
    listedGlossary?: { terms: unknown }[];
    /** A Glossary linked to the listed row. Defaults to none. */
    listedLinkedGlossary?: {
      name: string;
      sourceLang: string;
      isActive: boolean;
      items: { original: string; translation: string; targetLang: string }[];
    };
    /**
     * Rows already in the database for the context being saved, read by the
     * preserve-on-replace check BEFORE the delete. Defaults to none, so the
     * existing "takes positions from the array index" case keeps seeing
     * exactly the two rows `body` sends and nothing appended after them.
     */
    existingGlossary?: { terms: unknown }[];
    /** What the linked-glossary lookup finds. Defaults to the caller's glossary. */
    linkedGlossaryRow?: { id: string } | null;
    /** Who authored the held row. Defaults to `owner-1`, the caller. */
    heldOwnerId?: string;
    /** Whether the unscoped, any-scope id lookup finds a row. Defaults to no. */
    takenElsewhere?: boolean;
  } = {},
) {
  const calls: string[] = [];
  // A `where` without a scope key is the any-scope id check a team create
  // runs; every other lookup is the scoped read of the held row.
  const findFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
    if (!('teamId' in args.where)) {
      calls.push('findFirst.anyScope');
      return options.takenElsewhere ? { id: 'cuid-elsewhere' } : null;
    }
    calls.push('findFirst');
    return options.exists === false
      ? null
      : { id: 'cuid-1', ownerId: options.heldOwnerId ?? 'owner-1' };
  });
  const count = vi.fn(async () => {
    calls.push('count');
    return options.held ?? 0;
  });
  const create = vi.fn(async () => {
    calls.push('create');
    return { id: 'cuid-1' };
  });
  const update = vi.fn(async () => {
    calls.push('update');
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
  const locks: { sql: string; values: unknown[] }[] = [];
  const executeRaw = vi.fn(
    async (template: TemplateStringsArray, ...values: unknown[]) => {
      calls.push('advisoryLock');
      locks.push({ sql: template.join('?'), values });
      return 1;
    },
  );
  const findMany = vi.fn(async () => [
    row({
      ...(options.listedGlossary ? { glossary: options.listedGlossary } : {}),
      ...(options.listedLinkedGlossary
        ? {
            glossaryId: 'cuid-g-1',
            linkedGlossary: {
              clientId: GLOSSARY_CLIENT_ID,
              ...options.listedLinkedGlossary,
            },
          }
        : {}),
    }),
  ]);
  const glossaryFindMany = vi.fn(async () => {
    calls.push('glossary.findMany');
    return options.existingGlossary ?? [];
  });
  const contextDeleteMany = vi.fn(async () => {
    calls.push('deleteMany');
    return { count: 1 };
  });
  const glossaryFindFirst = vi.fn(async () => {
    calls.push('glossary.findFirst');
    return options.linkedGlossaryRow === undefined
      ? { id: 'cuid-g-1' }
      : options.linkedGlossaryRow;
  });

  const tx = {
    $executeRaw: executeRaw,
    translationContext: {
      findFirst,
      count,
      create,
      update,
      findUniqueOrThrow,
      deleteMany: contextDeleteMany,
    },
    glossaryTerm: { deleteMany, createMany, findMany: glossaryFindMany },
    glossary: { findFirst: glossaryFindFirst },
  };

  const prisma = {
    translationContext: { findMany },
    $transaction:
      options.transaction ??
      vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;

  return {
    store: new PrismaTranslationContextStore(prisma),
    calls,
    findFirst,
    count,
    create,
    update,
    executeRaw,
    locks,
    deleteMany,
    createMany,
    findMany,
    glossaryFindMany,
    contextDeleteMany,
    glossaryFindFirst,
    findUniqueOrThrow,
    transaction: (prisma as unknown as { $transaction: Mock }).$transaction,
  };
}

describe('PrismaTranslationContextStore', () => {
  it('scopes the list query to the personal scope', async () => {
    const { store, findMany } = fakePrisma();
    await store.list(ME);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: 'owner-1', teamId: null } }),
    );
  });

  it('addresses the row through the personal scope on save', async () => {
    const { store, findFirst, update } = fakePrisma();
    await store.save(ME, 'ctx-1', body, MAX);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: 'owner-1', teamId: null, clientId: 'ctx-1' },
      }),
    );
    // Written by the row's own id, never through the `(ownerId, clientId)`
    // unique, which cannot carry `teamId: null`.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cuid-1' } }),
    );
  });

  it('runs a team save under the team lock and the team scope', async () => {
    const { store, locks, findFirst, create } = fakePrisma({ exists: false });
    const team = mintTeamScope('u', 't', 'admin');

    await store.save(team, 'ctx-1', body, MAX);

    expect(locks[0]?.values).toEqual([8154, 't']);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 't', clientId: 'ctx-1' } }),
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 'u', teamId: 't' }),
      }),
    );
  });

  describe('reading a stored glossary', () => {
    const inline = [{ terms: { vi: 'hội đồng', en: 'committee' } }];
    const linked = (isActive: boolean) => ({
      name: 'Board terms',
      sourceLang: 'vi',
      isActive,
      items: [{ original: 'ban', translation: 'board', targetLang: 'en' }],
    });

    it('uses the linked glossary items when the glossary is active', async () => {
      const { store } = fakePrisma({
        listedGlossary: inline,
        listedLinkedGlossary: linked(true),
      });
      const [context] = await store.list(ME);
      expect(context?.glossary).toEqual([{ vi: 'ban', en: 'board' }]);
    });

    it("returns the linked glossary's client id, never the stored cuid", async () => {
      // The contract types both fields as the client-minted uuid, and the
      // client drops a context whose fields fail that parse — so echoing the
      // FK column would hide every linked context from the list.
      const { store } = fakePrisma({ listedLinkedGlossary: linked(true) });
      const [context] = await store.list(ME);
      expect(context?.linkedGlossaryId).toBe(GLOSSARY_CLIENT_ID);
      expect(context?.glossaryId).toBe(GLOSSARY_CLIENT_ID);
    });

    it('falls back to the inline terms when the linked glossary is inactive', async () => {
      const { store } = fakePrisma({
        listedGlossary: inline,
        listedLinkedGlossary: linked(false),
      });
      const [context] = await store.list(ME);
      expect(context?.glossary).toEqual([{ vi: 'hội đồng', en: 'committee' }]);
    });

    it('validates each row against glossaryEntrySchema on the way out', async () => {
      const { store } = fakePrisma({
        listedGlossary: [{ terms: { vi: 'hội đồng', en: 'committee' } }],
      });
      const [context] = await store.list(ME);
      expect(context?.glossary).toEqual([{ vi: 'hội đồng', en: 'committee' }]);
    });

    it('drops a row a past write corrupted without failing the whole context, and without a warning per read', async () => {
      // One side only: valid JSONB, but no longer a shape `glossaryEntrySchema`
      // accepts. A read has no way to repair it, so the contract this store
      // keeps is that ONE bad row costs its own entry, not the whole context —
      // the library stays readable for everything that was never touched.
      const { store } = fakePrisma({
        listedGlossary: [
          { terms: { vi: 'chỉ một bên' } },
          { terms: { vi: 'hội đồng', en: 'committee' } },
        ],
      });
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const [context] = await store.list(ME);
      expect(context?.glossary).toEqual([{ vi: 'hội đồng', en: 'committee' }]);
      // The row is still stored; the save that decides its fate reports it.
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it('addresses the row through the personal scope on delete', async () => {
    const { store, findFirst, contextDeleteMany, transaction } = fakePrisma();
    await expect(store.remove(ME, 'ctx-1')).resolves.toBe('removed');
    // Found through the scope, then deleted by its own id in the same
    // transaction, so the row checked is the row deleted.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: 'owner-1', teamId: null, clientId: 'ctx-1' },
      }),
    );
    expect(contextDeleteMany).toHaveBeenCalledWith({
      where: { id: 'cuid-1' },
    });
  });

  it('reports an id outside the scope as absent, deleting nothing', async () => {
    const { store, contextDeleteMany } = fakePrisma({ exists: false });
    await expect(store.remove(ME, 'ctx-1')).resolves.toBe('absent');
    expect(contextDeleteMany).not.toHaveBeenCalled();
  });

  describe('the author rule in a team', () => {
    const member = mintTeamScope('member-1', 't', 'member');
    const admin = mintTeamScope('admin-1', 't', 'admin');

    it("refuses a member replacing another member's context, touching nothing", async () => {
      const { store, update, deleteMany, glossaryFindMany } = fakePrisma({
        heldOwnerId: 'someone-else',
      });

      await expect(store.save(member, 'ctx-1', body, MAX)).resolves.toEqual({
        kind: 'forbidden',
      });
      expect(update).not.toHaveBeenCalled();
      expect(deleteMany).not.toHaveBeenCalled();
      expect(glossaryFindMany).not.toHaveBeenCalled();
    });

    it("lets an admin replace another member's context", async () => {
      const { store, update } = fakePrisma({ heldOwnerId: 'someone-else' });

      const saved = await store.save(admin, 'ctx-1', body, MAX);

      expect(saved.kind).toBe('saved');
      expect(update).toHaveBeenCalledTimes(1);
    });

    it('marks a team row with whether the caller may edit it', async () => {
      const { store, findUniqueOrThrow } = fakePrisma({
        heldOwnerId: 'member-1',
      });
      findUniqueOrThrow.mockResolvedValueOnce(row({ ownerId: 'member-1' }));

      const saved = await store.save(member, 'ctx-1', body, MAX);

      expect(saved).toMatchObject({ kind: 'saved', value: { canEdit: true } });
    });

    it("marks another member's team row as not editable, and leaks no author", async () => {
      const { store, findMany } = fakePrisma();
      findMany.mockResolvedValueOnce([row({ ownerId: 'someone-else' })]);

      const [listed] = await store.list(member);

      expect(listed?.canEdit).toBe(false);
      expect(listed).not.toHaveProperty('ownerId');
    });

    it('gives a personal row no canEdit key at all', async () => {
      const { store, findMany } = fakePrisma();
      findMany.mockResolvedValueOnce([row({ ownerId: 'owner-1' })]);

      const [listed] = await store.list(ME);

      expect(listed).not.toHaveProperty('canEdit');
      expect(listed).not.toHaveProperty('ownerId');
    });

    it('refuses a team create under an id used in any scope, creating nothing', async () => {
      const { store, create, count, calls } = fakePrisma({
        exists: false,
        takenElsewhere: true,
      });

      await expect(store.save(member, 'ctx-1', body, MAX)).resolves.toEqual({
        kind: 'id-in-use',
      });
      expect(create).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
      expect(calls).toContain('findFirst.anyScope');
    });

    it('runs no any-scope id check on a personal create', async () => {
      const { store, calls, create } = fakePrisma({
        exists: false,
        takenElsewhere: true,
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(calls).not.toContain('findFirst.anyScope');
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("refuses a member deleting another member's context", async () => {
      const { store, contextDeleteMany } = fakePrisma({
        heldOwnerId: 'someone-else',
      });

      await expect(store.remove(member, 'ctx-1')).resolves.toBe('forbidden');
      expect(contextDeleteMany).not.toHaveBeenCalled();
    });
  });

  it('replaces the glossary rather than appending, inside one transaction', async () => {
    const { store, calls, transaction } = fakePrisma();
    await store.save(ME, 'ctx-1', body, MAX);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('glossary.deleteMany')).toBeLessThan(
      calls.indexOf('glossary.createMany'),
    );
  });

  it('takes glossary positions from the array index', async () => {
    const { store, createMany } = fakePrisma();
    await store.save(ME, 'ctx-1', body, MAX);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          contextId: 'cuid-1',
          position: 0,
          terms: { vi: 'hội đồng phản biện', en: 'thesis defense committee' },
        },
        {
          contextId: 'cuid-1',
          position: 1,
          terms: { vi: 'luận văn', en: 'thesis' },
        },
      ],
    });
  });

  describe('a replace and a row the current schema cannot read', () => {
    it('carries an unreadable row through the replace instead of deleting it', async () => {
      // One-sided: `glossaryEntrySchema` refuses an entry present in fewer than
      // two languages. A row like this is exactly what `list()` already drops
      // from what the operator can see — and what its next Save, sending back
      // only what it could see, would otherwise take as "delete this".
      const unreadable = { vi: 'một bên' };
      const { store, createMany } = fakePrisma({
        existingGlossary: [{ terms: unreadable }],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(createMany).toHaveBeenCalledWith({
        data: [
          {
            contextId: 'cuid-1',
            position: 0,
            terms: { vi: 'hội đồng phản biện', en: 'thesis defense committee' },
          },
          {
            contextId: 'cuid-1',
            position: 1,
            terms: { vi: 'luận văn', en: 'thesis' },
          },
          // Appended after the operator's own two, at the next position —
          // never interleaved, and carried byte-for-byte rather than
          // re-validated, which would just drop it again.
          { contextId: 'cuid-1', position: 2, terms: unreadable },
        ],
      });
    });

    it('does not look for anything to preserve on a create — there is no prior row', async () => {
      const { store, glossaryFindMany } = fakePrisma({
        exists: false,
        held: 0,
      });

      await store.save(ME, 'ctx-new', body, MAX);

      expect(glossaryFindMany).not.toHaveBeenCalled();
    });

    it('reads what to preserve before the replace deletes it', async () => {
      const { store, calls } = fakePrisma({
        existingGlossary: [{ terms: { vi: 'một bên' } }],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(calls.indexOf('glossary.findMany')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('glossary.findMany')).toBeLessThan(
        calls.indexOf('glossary.deleteMany'),
      );
    });

    it('reads the stored rows in position order', async () => {
      const { store, glossaryFindMany } = fakePrisma({
        existingGlossary: [{ terms: { vi: 'một bên' } }],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(glossaryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { position: 'asc' } }),
      );
    });

    it('lets go of a row whose terms is not an object instead of re-inserting it', async () => {
      // JSON `null`, an array, a scalar: no rendering in any language to keep,
      // and a `null` re-inserted into the required column would fail every
      // later save of this context.
      const kept = { vi: 'một bên' };
      const { store, createMany } = fakePrisma({
        existingGlossary: [
          { terms: null },
          { terms: ['vi', 'en'] },
          { terms: 'hello' },
          { terms: kept },
        ],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ position: 0 }),
          expect.objectContaining({ position: 1 }),
          { contextId: 'cuid-1', position: 2, terms: kept },
        ],
      });
    });

    it('keeps preserved rows within the glossary cap, dropping the tail', async () => {
      // One slot left under the cap: the earliest unreadable row by position
      // takes it, and the later two are dropped rather than pushing the table
      // past the number of entries the contract admits.
      const nearlyFull: SaveTranslationContextRequest = {
        ...body,
        glossary: Array.from(
          { length: CONTEXT_LIMITS.MAX_GLOSSARY - 1 },
          (_, i) => ({ vi: `từ ${i}`, en: `word ${i}` }),
        ),
      };
      const first = { vi: 'thứ nhất' };
      const { store, createMany } = fakePrisma({
        existingGlossary: [
          { terms: first },
          { terms: { vi: 'thứ hai' } },
          { terms: { vi: 'thứ ba' } },
        ],
      });

      await store.save(ME, 'ctx-1', nearlyFull, MAX);

      const [[{ data }]] = createMany.mock.calls as unknown as [
        [{ data: { position: number; terms: unknown }[] }],
      ];
      expect(data).toHaveLength(CONTEXT_LIMITS.MAX_GLOSSARY);
      expect(data.at(-1)).toEqual({
        contextId: 'cuid-1',
        position: CONTEXT_LIMITS.MAX_GLOSSARY - 1,
        terms: first,
      });
    });

    it('preserves nothing once the body alone fills the cap', async () => {
      const full: SaveTranslationContextRequest = {
        ...body,
        glossary: Array.from(
          { length: CONTEXT_LIMITS.MAX_GLOSSARY },
          (_, i) => ({
            vi: `từ ${i}`,
            en: `word ${i}`,
          }),
        ),
      };
      const { store, createMany } = fakePrisma({
        existingGlossary: [{ terms: { vi: 'một bên' } }],
      });

      await store.save(ME, 'ctx-1', full, MAX);

      const [[{ data }]] = createMany.mock.calls as unknown as [
        [{ data: unknown[] }],
      ];
      expect(data).toHaveLength(CONTEXT_LIMITS.MAX_GLOSSARY);
    });

    it('warns once per save with what was kept and what was dropped', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const { store } = fakePrisma({
        existingGlossary: [
          { terms: null },
          { terms: { vi: 'một bên' } },
          { terms: { en: 'one side' } },
        ],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(
        /carrying 2 unreadable .*discarding 1 with no term map and 0 past/,
      );
      warn.mockRestore();
    });

    it('does not warn when every stored row is readable', async () => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const { store } = fakePrisma({
        existingGlossary: [{ terms: { vi: 'luận văn', en: 'thesis' } }],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('preserves nothing when every existing row is already readable', async () => {
      const { store, createMany } = fakePrisma({
        existingGlossary: [
          {
            terms: { vi: 'hội đồng phản biện', en: 'thesis defense committee' },
          },
        ],
      });

      await store.save(ME, 'ctx-1', body, MAX);

      expect(createMany).toHaveBeenCalledWith({
        data: [
          {
            contextId: 'cuid-1',
            position: 0,
            terms: { vi: 'hội đồng phản biện', en: 'thesis defense committee' },
          },
          {
            contextId: 'cuid-1',
            position: 1,
            terms: { vi: 'luận văn', en: 'thesis' },
          },
        ],
      });
    });
  });

  it('locks the owner before it reads anything it acts on', async () => {
    // The lock is what lets every other claim in this file hold under
    // concurrency, and it only does that if nothing this transaction acts on is
    // read before it. Asserted on the ORDER, because a lock taken after the
    // membership probe would satisfy any assertion that it was taken at all and
    // would still leave open the window it exists to close.
    const { store, calls, executeRaw } = fakePrisma();

    await store.save(ME, 'ctx-1', body, MAX);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(calls[0]).toBe('advisoryLock');
  });

  it('keys the lock on the owner, under this module own class', async () => {
    // Transaction-scoped, because Prisma returns connections to a pool and a
    // session-scoped lock could be released on a different connection than took
    // it. Two ints rather than one bigint: the first names this module, so
    // another feature's lock cannot collide with one taken here. Postgres does
    // the hashing, so the key cannot drift from the owner id.
    const { store, locks } = fakePrisma();

    await store.save(ME, 'ctx-1', body, MAX);

    expect(locks[0]?.values[0]).toBe(8154);
    expect(locks[0]?.sql).toContain('pg_advisory_xact_lock');
    expect(locks[0]?.sql).not.toContain('pg_advisory_lock(');
    expect(locks[0]?.sql).toContain('hashtext');
    expect(locks[0]?.values[1]).toBe('owner-1');
  });

  describe('the per-owner ceiling', () => {
    it('refuses a create once the owner holds the maximum, writing nothing', async () => {
      const { store, create, update, createMany } = fakePrisma({
        exists: false,
        held: MAX,
      });

      // A result and not a throw: what a breached ceiling means to a caller is
      // the service's to say, and a store that threw `ConflictException` would
      // put the status code in the persistence layer.
      await expect(store.save(ME, 'ctx-new', body, MAX)).resolves.toEqual({
        kind: 'limit',
      });
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
    });

    it('counts inside the transaction that writes, and before it writes', async () => {
      // The whole of the fix. A count taken before the transaction is a read
      // with nothing holding it: two creates fired together one short of the
      // ceiling both see room and both commit. Inside it, and after the lock
      // above, the count is a fresh read of a library no other save for this
      // owner can be writing to.
      const { store, calls, transaction } = fakePrisma({
        exists: false,
        held: MAX - 1,
      });

      await store.save(ME, 'ctx-new', body, MAX);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(calls.indexOf('count')).toBeGreaterThanOrEqual(0);
      expect(calls.indexOf('count')).toBeLessThan(calls.indexOf('create'));
    });

    it('scopes the count to the personal scope', async () => {
      const { store, count } = fakePrisma({ exists: false, held: 0 });
      await store.save(ME, 'ctx-new', body, MAX);
      expect(count).toHaveBeenCalledWith({
        where: { ownerId: 'owner-1', teamId: null },
      });
    });

    it('allows a replace at the ceiling without counting at all', async () => {
      // A replace adds no row, so it is never refused — a ceiling applied to
      // every write would make a full library permanently uneditable. It still
      // takes the owner's lock, which is what a replace stopped avoiding when
      // the lock replaced the isolation level; what it avoids is the count.
      const { store, count, update } = fakePrisma({ exists: true, held: MAX });

      const saved = await store.save(ME, 'ctx-1', body, MAX);

      expect(saved.kind).toBe('saved');
      expect(count).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe('linking a glossary', () => {
    const linking: SaveTranslationContextRequest = {
      ...body,
      glossaryId: GLOSSARY_CLIENT_ID,
    };

    it("stores the glossary's server id, looked up in the context's scope", async () => {
      const { store, update, glossaryFindFirst } = fakePrisma();

      const saved = await store.save(ME, 'ctx-1', linking, MAX);

      expect(saved.kind).toBe('saved');
      expect(glossaryFindFirst).toHaveBeenCalledWith({
        where: {
          ownerId: 'owner-1',
          teamId: null,
          clientId: GLOSSARY_CLIENT_ID,
        },
        select: { id: true },
      });
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ glossaryId: 'cuid-g-1' }),
        }),
      );
    });

    it("stores the glossary's server id on a create too", async () => {
      const { store, create } = fakePrisma({ exists: false });

      await store.save(ME, 'ctx-new', linking, MAX);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ glossaryId: 'cuid-g-1' }),
        }),
      );
    });

    it('refuses a glossary outside the scope, writing nothing', async () => {
      const { store, create, update, createMany } = fakePrisma({
        linkedGlossaryRow: null,
      });

      await expect(store.save(ME, 'ctx-1', linking, MAX)).resolves.toEqual({
        kind: 'glossary-missing',
      });
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
    });

    it('looks the glossary up after taking the lock', async () => {
      const { store, calls } = fakePrisma();

      await store.save(ME, 'ctx-1', linking, MAX);

      expect(calls.indexOf('glossary.findFirst')).toBeGreaterThan(
        calls.indexOf('advisoryLock'),
      );
    });

    it('does not look anything up when no glossary is linked', async () => {
      const { store, update, glossaryFindFirst } = fakePrisma();

      await store.save(ME, 'ctx-1', body, MAX);

      expect(glossaryFindFirst).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ glossaryId: null }),
        }),
      );
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
    await expect(store.save(ME, 'ctx-1', body, MAX)).rejects.toBe(conflict);
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

    await expect(store.save(ME, 'ctx-1', body, MAX)).rejects.toBe(wrapped);
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('does not retry a conflict a retry cannot resolve', async () => {
    // A unique violation is not transient: re-running the identical body hits
    // the identical constraint, so the retry would only spend more transactions
    // before failing anyway.
    const permanent = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
    });
    const transaction = vi.fn(async () => {
      throw permanent;
    });
    const { store } = fakePrisma({ transaction });

    await expect(store.save(ME, 'ctx-1', body, MAX)).rejects.toBe(permanent);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// The AI Context library against a REAL Postgres.
//
// The controller and service specs beside the module drive an in-memory double,
// which is enough for the status codes and for the ceiling's decision table. It
// is not enough for anything the schema owns, and three claims here are only the
// schema's:
//
//   - `@@unique([ownerId, clientId])` is a COMPOUND. It is what makes the same
//     client-minted id legal for two accounts and what makes a foreign id
//     resolve to nothing rather than to someone else's dictionary. A double that
//     keys its map by `contextId` alone agrees with itself and disagrees with
//     Postgres.
//   - The delete is idempotent by design — 204 whether a row went or not,
//     because the service discards the store's answer — so the STATUS cannot
//     distinguish "yours went" from "someone else's survived". Only a row count
//     taken directly from `prisma` can, which is why the ownership case below
//     reads the surviving row rather than re-asking the API.
//   - `GlossaryTerm` cascades from its context and is unique on
//     `(contextId, position)`. A replace deletes and re-inserts inside one
//     SERIALIZABLE transaction, and the positions come from the array index, so
//     a shorter re-save leaving a stale tail, a duplicate position, or an
//     orphaned pair are all failures a mocked store cannot express.
//
// The per-owner ceiling is here for the opposite reason: it is the one rule
// Postgres CANNOT hold. "At most 20 rows per owner" is a count, and there is no
// constraint over a count, so the service reads, decides and then writes with
// nothing between — see the concurrent-creates case for what that really buys.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import {
  ThrottlerStorage,
  type ThrottlerStorageService,
} from '@nestjs/throttler';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  CONTEXT_LIMITS,
  type SaveTranslationContextRequest,
} from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('AI Context library (db-e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: Identity;
  let bob: Identity;

  /**
   * Every identity this file creates, for the cleanup.
   *
   * `TranslationContext.ownerId` carries NO relation to `User` — the schema says
   * so deliberately — so deleting the run's users cascades nothing and the
   * contexts have to be deleted by owner id explicitly. Collected here because
   * the ceiling cases each need an account whose library starts empty.
   */
  const owners: Identity[] = [];

  beforeAll(async () => {
    // No provider overrides: every seam this suite exercises is the real one.
    // The point of the file is the durable store, and the throttle is handled
    // per-case below rather than removed, so the guard stays in the graph.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    prisma = app.get(PrismaService);
    alice = await freshOwner('alice');
    bob = await freshOwner('bob');
  });

  afterAll(async () => {
    await prisma.translationContext.deleteMany({
      where: { ownerId: { in: owners.map((owner) => owner.userId) } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    // PUT and DELETE allow 30 a minute from one address and GET 60, all counted
    // per address — and every case here calls from the same one. Filling a
    // library to the ceiling spends twenty of those on its own, so without this
    // the suite would assert rate limiting by accident and the later cases would
    // answer 429. Clearing the counter makes the budget per-case; the guard
    // itself is untouched.
    (app.get(ThrottlerStorage) as ThrottlerStorageService).storage.clear();
  });

  it('creates, lists, replaces and deletes one context', async () => {
    const id = randomUUID();

    const created = await put(id, alice).expect(200);
    expect(created.body.data.context).toMatchObject({
      id,
      name: 'Cardiology consult',
      topic: 'a follow-up appointment',
      hotwords: ['Dr. Ha', 'ECG'],
      style: 'formal',
    });

    const listed = await list(alice).expect(200);
    expect(idsOf(listed)).toContain(id);

    const replaced = await put(
      id,
      alice,
      body({ name: 'Cardiology follow-up', style: 'neutral' }),
    ).expect(200);
    expect(replaced.body.data.context).toMatchObject({
      id,
      name: 'Cardiology follow-up',
      style: 'neutral',
    });

    // The replace must not have created a second row under the same id — the
    // compound unique is what makes the upsert an upsert, and a list that showed
    // two entries here would say the save keyed on something else.
    expect(
      await prisma.translationContext.count({
        where: { ownerId: alice.userId, clientId: id },
      }),
    ).toBe(1);

    await del(id, alice).expect(204);

    const after = await list(alice).expect(200);
    expect(idsOf(after)).not.toContain(id);
  });

  it('lists newest first and moves an edited context back to the head', async () => {
    const who = await freshOwner('ordering');
    const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];

    // Awaited one at a time on purpose: the order under test is by `updatedAt`,
    // so the writes have to be ordered in time for the expectation to mean
    // anything.
    await put(first, who, body({ name: 'first' })).expect(200);
    await put(second, who, body({ name: 'second' })).expect(200);
    await put(third, who, body({ name: 'third' })).expect(200);

    const listed = await list(who).expect(200);
    expect(idsOf(listed)).toEqual([third, second, first]);

    // `updatedAt` and not `createdAt`: editing the oldest entry has to bring it
    // to the top of the picker, and a list sorted on creation would keep it
    // buried while still passing the assertion above.
    await put(first, who, body({ name: 'first, edited' })).expect(200);
    const reordered = await list(who).expect(200);
    expect(idsOf(reordered)).toEqual([first, third, second]);
  });

  describe('owner scoping', () => {
    it('lists only the caller own contexts', async () => {
      const hers = randomUUID();
      const his = randomUUID();
      await put(hers, alice, body({ name: 'hers' })).expect(200);
      await put(his, bob, body({ name: 'his' })).expect(200);

      const listed = await list(alice).expect(200);
      expect(idsOf(listed)).toContain(hers);
      expect(idsOf(listed)).not.toContain(his);
    });

    it('lets two accounts hold the same client-minted id as separate rows', async () => {
      // One id, saved by both. Legal only because the unique is the COMPOUND
      // `(ownerId, clientId)`: a unique on `clientId` alone would answer 500 on
      // the second save here, and a store that upserted on `clientId` alone
      // would answer 200 and quietly overwrite Bob's dictionary with Alice's.
      const shared = randomUUID();
      await put(shared, bob, body({ name: 'bob library entry' })).expect(200);
      await put(shared, alice, body({ name: 'alice library entry' })).expect(
        200,
      );

      const bobRow = await rowFor(bob, shared);
      const aliceRow = await rowFor(alice, shared);
      expect(bobRow?.id).toBeTruthy();
      expect(aliceRow?.id).toBeTruthy();
      expect(aliceRow?.id).not.toBe(bobRow?.id);
      expect(bobRow?.name).toBe('bob library entry');
      expect(aliceRow?.name).toBe('alice library entry');
    });

    it('answers 204 to a delete of another account context and leaves the row standing', async () => {
      const his = randomUUID();
      await put(his, bob, body({ name: 'bob only' })).expect(200);

      // Exactly 204, because the route is idempotent by design and says nothing
      // about whether a row existed. That is also why the status proves nothing
      // here: `remove()` discards the store's answer, so a store that deleted by
      // `clientId` alone would answer 204 having destroyed Bob's row.
      await del(his, alice).expect(204);

      // The assertion that actually distinguishes the two, read straight from
      // the database rather than through an API that is built not to tell.
      const survivor = await rowFor(bob, his);
      expect(survivor?.name).toBe('bob only');
      expect(
        await prisma.translationContext.count({ where: { clientId: his } }),
      ).toBe(1);
    });
  });

  describe('the glossary', () => {
    it('stores pairs in the authored order, at positions 0..n-1', async () => {
      const id = randomUUID();
      // Deliberately not alphabetical in either language: `position` is the only
      // thing that can reproduce this order, since Postgres has no inherent row
      // order and would be free to hand back any permutation.
      const glossary = [
        { vi: 'huyết áp', en: 'blood pressure' },
        { vi: 'đơn thuốc', en: 'prescription' },
        { vi: 'nhịp tim', en: 'heart rate' },
      ];
      const saved = await put(id, alice, body({ glossary })).expect(200);
      expect(saved.body.data.context.glossary).toEqual(glossary);

      const stored = await glossaryRowsFor(alice, id);
      expect(stored.map((term) => term.position)).toEqual([0, 1, 2]);
      expect(stored.map((term) => term.en)).toEqual([
        'blood pressure',
        'prescription',
        'heart rate',
      ]);

      // The read path, re-checked on a second request rather than only on the
      // echo the write returned: the echo is selected inside the same
      // transaction that wrote it, so it could agree while a plain list did not.
      const listed = await list(alice).expect(200);
      expect(contextIn(listed, id).glossary).toEqual(glossary);
    });

    it('leaves no stale tail and no duplicate position when a re-save is shorter', async () => {
      const id = randomUUID();
      await put(
        id,
        alice,
        body({
          glossary: [
            { vi: 'nhịp tim', en: 'heart rate' },
            { vi: 'huyết áp', en: 'blood pressure' },
            { vi: 'đơn thuốc', en: 'prescription' },
          ],
        }),
      ).expect(200);
      const before = await rowFor(alice, id);

      const shorter = [{ vi: 'huyết áp', en: 'blood pressure' }];
      const replaced = await put(id, alice, body({ glossary: shorter })).expect(
        200,
      );
      expect(replaced.body.data.context.glossary).toEqual(shorter);

      // Delete-then-insert, not merge. A merging save would leave the two
      // dropped pairs behind at positions 1 and 2, and the operator would go on
      // sending the model renderings they had already removed. An insert that
      // re-used a position without clearing the old rows could not even commit:
      // `@@unique([contextId, position])` refuses it.
      const stored = await glossaryRowsFor(alice, id);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ position: 0, en: 'blood pressure' });

      // Counted against the cuid the FIRST save wrote, which is also the check
      // that the replace updated the parent rather than replacing it: a save
      // that deleted and re-created the context would satisfy every assertion
      // above while leaving three pairs under an abandoned row that no list and
      // no cascade will ever reach again.
      const after = await rowFor(alice, id);
      expect(after!.id).toBe(before!.id);
      expect(
        await prisma.glossaryTerm.count({ where: { contextId: before!.id } }),
      ).toBe(1);
    });

    it('takes the glossary with the context when it is deleted', async () => {
      const id = randomUUID();
      await put(id, alice).expect(200);

      // The parent's server cuid, captured BEFORE the delete: after it there is
      // nothing left to resolve the client id against, and a query by client id
      // could not tell an empty result from a cascade that never ran.
      const parent = await rowFor(alice, id);
      expect(
        await prisma.glossaryTerm.count({ where: { contextId: parent!.id } }),
      ).toBe(3);

      await del(id, alice).expect(204);

      // The cascade, asserted directly rather than inferred from the list: a
      // parent delete that orphaned its children would still drop the context
      // out of the library, and the rows would sit there unreachable and
      // uncountable against the operator's own dictionary.
      expect(
        await prisma.glossaryTerm.count({ where: { contextId: parent!.id } }),
      ).toBe(0);
    });
  });

  describe('the per-owner ceiling', () => {
    it('refuses a create past the ceiling with 409', async () => {
      const who = await freshOwner('ceiling-create');
      await fill(who, CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER);

      // Exactly 409. A range, or anything that also accepted a 400, would let a
      // validation refusal stand in for the ceiling — and 400 is what an
      // over-long name or a five-word glossary term answers, so the two really
      // can be confused by a lazy assertion.
      await put(randomUUID(), who).expect(409);

      expect(
        await prisma.translationContext.count({
          where: { ownerId: who.userId },
        }),
      ).toBe(CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER);
    });

    it('allows a replace of an id already held at the ceiling', async () => {
      const who = await freshOwner('ceiling-replace');
      const held = await fill(who, CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER);

      // The reason the service counts first and checks membership second. A
      // ceiling applied to every write would make a full library permanently
      // uneditable: the operator could neither add to it nor correct what is in
      // it, and the only way out would be deleting an entry they wanted.
      const replaced = await put(
        held[0]!,
        who,
        body({ name: 'corrected at the ceiling' }),
      ).expect(200);
      expect(replaced.body.data.context.name).toBe('corrected at the ceiling');

      expect(
        await prisma.translationContext.count({
          where: { ownerId: who.userId },
        }),
      ).toBe(CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER);
    });

    it('can let two creates fired together at the ceiling both land, and refuses the next one', async () => {
      const who = await freshOwner('ceiling-race');
      await fill(who, CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER - 1);

      // Fired without awaiting the first, so both reach the service's count
      // while the library is one short of full and both are told there is room.
      const [first, second] = await Promise.all([
        put(randomUUID(), who),
        put(randomUUID(), who),
      ]);

      // The honest claim, and it is the DATABASE's, not the service's: the
      // ceiling is a count, and Postgres has no constraint over a count, so
      // nothing stands between the service's read and its write to serialise
      // them. When two creates both read "19 held" they both pass the gate and
      // both commit, and the account ends up holding 21 — one over a ceiling
      // the product states as a maximum.
      //
      // Both outcomes really do occur, so naming either one would be a flaky
      // test rather than a strict one: over six runs against a warm local
      // Postgres this settled 200/409 at 20 rows four times and 200/200 at 21
      // rows twice, on the same machine with nothing changed between them.
      // Which it is depends on whether the second request's count query is
      // dispatched before the first transaction commits, and nothing in the
      // code decides that.
      //
      // So the assertion couples the statuses to the row count instead of
      // naming an outcome — which is not vacuous: a 409 that still wrote a row,
      // a 200 whose write was lost, and a 500 from either request all fail it.
      // Tightening this to "at most 20 rows, always" is a product decision, and
      // it needs a lock or a deferred constraint trigger, not a test.
      const settled = [first.status, second.status];
      expect(settled.every((status) => status === 200 || status === 409)).toBe(
        true,
      );
      const created = settled.filter((status) => status === 200).length;
      expect(
        await prisma.translationContext.count({
          where: { ownerId: who.userId },
        }),
      ).toBe(CONTEXT_LIMITS.MAX_CONTEXTS_PER_OWNER - 1 + created);

      // And the overshoot does not compound. Whatever the race left behind, the
      // next create is a single read that sees a library at or over the ceiling
      // and refuses — so the library converges at the gate rather than drifting
      // further with every concurrent pair.
      await put(randomUUID(), who).expect(409);
    });
  });

  /** PUT one context, unsent, so a caller can await it or race it. */
  function put(
    id: string,
    who: Identity,
    payload: SaveTranslationContextRequest = body(),
  ) {
    return request(app.getHttpServer())
      .put(`/translation-contexts/${id}`)
      .set('authorization', who.bearer)
      .send(payload);
  }

  function list(who: Identity) {
    return request(app.getHttpServer())
      .get('/translation-contexts')
      .set('authorization', who.bearer);
  }

  function del(id: string, who: Identity) {
    return request(app.getHttpServer())
      .delete(`/translation-contexts/${id}`)
      .set('authorization', who.bearer);
  }

  /**
   * Saves `howMany` contexts through the real route and returns their ids.
   *
   * Sequential rather than concurrent: these are the SETUP for the ceiling
   * cases, so they must land one at a time or the fill would itself be the race
   * the last case is about.
   */
  async function fill(who: Identity, howMany: number): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < howMany; index += 1) {
      const id = randomUUID();
      await put(id, who, body({ name: `entry ${index}` })).expect(200);
      ids.push(id);
    }
    return ids;
  }

  /** The stored row for one owner's client id, or null. */
  function rowFor(who: Identity, contextId: string) {
    return prisma.translationContext.findUnique({
      where: { ownerId_clientId: { ownerId: who.userId, clientId: contextId } },
      select: { id: true, name: true },
    });
  }

  /** The stored glossary rows for one owner's context, in position order. */
  async function glossaryRowsFor(who: Identity, contextId: string) {
    const parent = await rowFor(who, contextId);
    return prisma.glossaryTerm.findMany({
      where: { contextId: parent!.id },
      orderBy: { position: 'asc' },
      select: { position: true, vi: true, en: true },
    });
  }

  /** Registers an identity and records it for the cleanup. */
  async function freshOwner(label: string): Promise<Identity> {
    const who = await registerAndLogin(app, {
      email: `${label}-${run}@ctx-db-e2e.example.com`,
    });
    owners.push(who);
    return who;
  }
});

/** A complete, valid context body. Three glossary pairs unless overridden. */
function body(
  overrides: Partial<SaveTranslationContextRequest> = {},
): SaveTranslationContextRequest {
  return {
    name: 'Cardiology consult',
    topic: 'a follow-up appointment',
    hotwords: ['Dr. Ha', 'ECG'],
    style: 'formal',
    glossary: [
      { vi: 'nhịp tim', en: 'heart rate' },
      { vi: 'huyết áp', en: 'blood pressure' },
      { vi: 'đơn thuốc', en: 'prescription' },
    ],
    ...overrides,
  };
}

interface ListedContext {
  id: string;
  name: string;
  glossary: { vi: string; en: string }[];
}

function idsOf(res: { body: { data: { contexts: ListedContext[] } } }) {
  return res.body.data.contexts.map((context) => context.id);
}

function contextIn(
  res: { body: { data: { contexts: ListedContext[] } } },
  id: string,
): ListedContext {
  const found = res.body.data.contexts.find((context) => context.id === id);
  if (!found) throw new Error(`the list did not carry ${id}`);
  return found;
}

// Conversation history against a REAL Postgres.
//
// There is no fast counterpart: everything worth asserting here is a property of
// the durable store — the compound `(ownerId, clientId)` unique that scopes a
// conversation to its owner, that a re-save REPLACES the turns rather than
// appending, that two overlapping saves cannot violate the positional unique,
// and that deleting a conversation takes its turns with it. An in-memory double
// would prove only that the double agrees with itself.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { HISTORY_LIMITS, type SaveConversationRequest } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerNarrowBodyLimits } from '../src/common/middleware/narrow-body-limits';
import { registerAndLogin, type Identity } from './utils/auth-fixture';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Conversation history (db-e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let alice: Identity;
  let bob: Identity;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    // The same two registrations `bootstrap` performs, in the same order — and
    // both are load-bearing. The narrow limits must come first, because
    // body-parser marks a request it has read and every later parser skips it.
    // The global parser must then be registered EXPLICITLY: Nest only installs
    // its own when none is applied yet, so the narrow one above would otherwise
    // silently leave every other route with an unparsed body.
    registerNarrowBodyLimits(app);
    app.useBodyParser('json', { limit: '12mb' });
    await app.init();

    prisma = app.get(PrismaService);
    alice = await registerAndLogin(app, {
      email: `alice-${run}@conv-db-e2e.example.com`,
    });
    bob = await registerAndLogin(app, {
      email: `bob-${run}@conv-db-e2e.example.com`,
    });
  });

  afterAll(async () => {
    await prisma.conversation.deleteMany({
      where: { ownerId: { in: [alice.userId, bob.userId] } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  it('saves a conversation and reads it back after a fresh app instance', async () => {
    const id = randomUUID();
    await put(id, alice, body()).expect(200);

    // A SECOND Nest instance on the same database: an in-process cache would
    // sail through a same-app read, so the point is that nothing survives in
    // memory between the write and the read.
    const second = await bootSecondApp();
    try {
      const res = await request(second.getHttpServer())
        .get(`/conversations/${id}`)
        .set('authorization', alice.bearer)
        .expect(200);

      expect(res.body.data.conversation).toMatchObject({
        conversationId: id,
        direction: 'vi_to_en',
        turnCount: 2,
        preview: 'xin chào',
      });
      expect(res.body.data.conversation.turns).toEqual([
        {
          position: 0,
          speakerRole: 'speaker_a',
          speakerLabel: 'Ana',
          sourceText: 'xin chao',
          displayText: 'xin chào',
          targetText: 'hello',
        },
        {
          position: 1,
          speakerRole: 'speaker_b',
          speakerLabel: null,
          sourceText: 'khoẻ không',
          displayText: null,
          targetText: 'how are you',
        },
      ]);
    } finally {
      await second.close();
    }
  });

  it("answers 404 for another user's conversation, identically to an absent one", async () => {
    const id = randomUUID();
    await put(id, alice, body()).expect(200);

    const foreign = await request(app.getHttpServer())
      .get(`/conversations/${id}`)
      .set('authorization', bob.bearer)
      .expect(404);

    const absent = await request(app.getHttpServer())
      .get(`/conversations/${randomUUID()}`)
      .set('authorization', bob.bearer)
      .expect(404);

    // Identical apart from the envelope meta (a fresh requestId and timestamp
    // per request) and the id each message echoes back. Anything else that
    // differed would say whether the conversation exists.
    expect(comparableError(foreign.body)).toEqual(comparableError(absent.body));
  });

  it('a re-save replaces the stored turns rather than appending them', async () => {
    const id = randomUUID();
    await put(id, alice, body()).expect(200);

    const shorter = body();
    shorter.turns = [{ ...body().turns[0]!, speakerLabel: 'Renamed' }];
    await put(id, alice, shorter).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(200);

    // A merge bug would show three turns, or the old label on the first.
    expect(res.body.data.conversation.turns).toHaveLength(1);
    expect(res.body.data.conversation.turns[0].speakerLabel).toBe('Renamed');
    expect(res.body.data.conversation.turnCount).toBe(1);
  });

  it('two overlapping saves of one conversation both resolve without a unique violation', async () => {
    const id = randomUUID();
    // Fired without awaiting the first: under READ COMMITTED both transactions
    // can delete and then both insert, and the second hits
    // @@unique([conversationId, position]) as a P2002 the caller sees as a 500.
    const [first, second] = await Promise.all([
      put(id, alice, body()),
      put(id, alice, body()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const res = await request(app.getHttpServer())
      .get(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(200);
    expect(res.body.data.conversation.turns).toHaveLength(2);
  });

  it('deleting a conversation removes its turns', async () => {
    const id = randomUUID();
    await put(id, alice, body()).expect(200);

    const row = await prisma.conversation.findUniqueOrThrow({
      where: { ownerId_clientId: { ownerId: alice.userId, clientId: id } },
      select: { id: true },
    });

    await request(app.getHttpServer())
      .delete(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(404);

    // The cascade, asserted directly rather than inferred from the 404 above —
    // a parent delete that orphaned its children would still 404 on the read.
    expect(
      await prisma.conversationTurn.count({
        where: { conversationId: row.id },
      }),
    ).toBe(0);
  });

  it("refuses to delete another user's conversation and leaves it intact", async () => {
    const id = randomUUID();
    await put(id, alice, body()).expect(200);
    const row = await prisma.conversation.findUniqueOrThrow({
      where: { ownerId_clientId: { ownerId: alice.userId, clientId: id } },
      select: { id: true },
    });

    await request(app.getHttpServer())
      .delete(`/conversations/${id}`)
      .set('authorization', bob.bearer)
      .expect(404);

    // Asserted on the ROWS, not only through Alice's read. Dropping `ownerId`
    // from the delete filter compiles, answers 204, and destroys a conversation
    // the caller does not own — with its turns and its minutes through the
    // cascade. It is the one route in this feature whose damage cannot be
    // undone, so the survival of the data is what is asserted.
    expect(await prisma.conversation.count({ where: { id: row.id } })).toBe(1);
    expect(
      await prisma.conversationTurn.count({
        where: { conversationId: row.id },
      }),
    ).toBe(2);

    const still = await request(app.getHttpServer())
      .get(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(200);
    expect(still.body.data.conversation.turns).toHaveLength(2);
  });

  it('refuses a save over HISTORY_LIMITS.MAX_TOTAL_CHARS with 400', async () => {
    const oversized = body();
    // Under the per-field cap, over the total: the sum is what is refused, and
    // a per-field-only check would let this through.
    oversized.turns = Array.from(
      { length: Math.ceil(HISTORY_LIMITS.MAX_TOTAL_CHARS / 3_000) + 1 },
      (_, position) => ({
        position,
        speakerRole: 'speaker_a' as const,
        speakerLabel: null,
        sourceText: 'x'.repeat(3_000),
        displayText: null,
        targetText: '',
      }),
    );

    await put(randomUUID(), alice, oversized).expect(400);
  });

  it('refuses a body over the parser ceiling with 413, before it is parsed', async () => {
    // Deliberately NOT valid JSON past the first bytes: a 413 here proves the
    // parser refused on length. If the ceiling were only the zod refine, this
    // would have been read, JSON.parsed and answered 400 instead.
    const res = await request(app.getHttpServer())
      .put(`/conversations/${randomUUID()}`)
      .set('authorization', alice.bearer)
      .set('content-type', 'application/json')
      .send(`{"pad":"${'x'.repeat(2 * 1024 * 1024)}"}`)
      .expect(413);

    // And it is the standard envelope, not express's HTML default: a parser
    // refusal is a client error the caller can act on, so it must not surface
    // as an opaque 500.
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });

  it('refuses a non-uuid conversation id with 400', async () => {
    // An unvalidated id reaches a btree unique index, where Postgres refuses a
    // tuple over ~2704 bytes as a 500 — a 400 is the honest answer.
    await put('not-a-uuid', alice, body()).expect(400);
    await put('x'.repeat(4_000), alice, body()).expect(400);
  });

  it('refuses two turns at the same position with 400', async () => {
    const duplicate = body();
    duplicate.turns = [
      duplicate.turns[0]!,
      { ...duplicate.turns[1]!, position: 0 },
    ];

    // `position` is the row key. A body Postgres can never store is refused
    // here, where the answer is a 400 the client can act on — reaching the
    // store instead produces a unique violation on a body that will fail
    // identically every time, and the caller sees a 500 it reads as "retry".
    await put(randomUUID(), alice, duplicate).expect(400);
  });

  it('refuses endedAt earlier than startedAt with 400', async () => {
    const backwards = body();
    backwards.endedAt = new Date(
      Date.parse(backwards.startedAt) - 1,
    ).toISOString();
    await put(randomUUID(), alice, backwards).expect(400);
  });

  it('caps the list page size at MAX_PAGE_SIZE', async () => {
    await request(app.getHttpServer())
      .get(`/conversations?limit=${HISTORY_LIMITS.MAX_PAGE_SIZE + 1}`)
      .set('authorization', alice.bearer)
      .expect(400);

    const ok = await request(app.getHttpServer())
      .get(`/conversations?limit=${HISTORY_LIMITS.MAX_PAGE_SIZE}`)
      .set('authorization', alice.bearer)
      .expect(200);
    expect(Array.isArray(ok.body.data.conversations)).toBe(true);
    expect(ok.body.data).toHaveProperty('nextCursor');
  });

  it('lists the caller conversations newest first and pages by cursor', async () => {
    const carol = await registerAndLogin(app, {
      email: `carol-${run}@conv-db-e2e.example.com`,
    });
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const id of ids) await put(id, carol, body()).expect(200);

    const first = await request(app.getHttpServer())
      .get('/conversations?limit=2')
      .set('authorization', carol.bearer)
      .expect(200);
    expect(
      first.body.data.conversations.map(
        (c: { conversationId: string }) => c.conversationId,
      ),
    ).toEqual([ids[2], ids[1]]);
    expect(first.body.data.nextCursor).not.toBeNull();

    const next = await request(app.getHttpServer())
      .get(`/conversations?limit=2&cursor=${first.body.data.nextCursor}`)
      .set('authorization', carol.bearer)
      .expect(200);
    expect(
      next.body.data.conversations.map(
        (c: { conversationId: string }) => c.conversationId,
      ),
    ).toEqual([ids[0]]);
    expect(next.body.data.nextCursor).toBeNull();

    // Carol's rows are not in Alice's list, and vice versa.
    const alicesList = await request(app.getHttpServer())
      .get('/conversations?limit=100')
      .set('authorization', alice.bearer)
      .expect(200);
    expect(
      alicesList.body.data.conversations.map(
        (c: { conversationId: string }) => c.conversationId,
      ),
    ).not.toContain(ids[0]);

    await prisma.conversation.deleteMany({ where: { ownerId: carol.userId } });
    await prisma.user.deleteMany({ where: { id: carol.userId } });
  });

  describe('search', () => {
    // One owner, one searchable conversation, and a second owner holding a
    // conversation that matches the same term — which is what the IDOR case
    // below needs.
    let searchable: string;
    let dave: Identity;

    beforeAll(async () => {
      searchable = randomUUID();
      const payload = body();
      payload.turns = [
        {
          position: 0,
          speakerRole: 'speaker_a',
          speakerLabel: 'Ana',
          // Raw vs repaired differ, so a search for the REPAIRED phrase proves
          // the index and the query cover what the reader actually saw.
          sourceText: 'bao cao ngan sach',
          displayText: 'báo cáo ngân sách',
          targetText: 'the budget report',
        },
        {
          position: 1,
          speakerRole: 'speaker_b',
          speakerLabel: null,
          // Stored WITHOUT diacritics and never repaired — the half that proves
          // an accented term still finds it.
          sourceText: 'ky hop dong',
          displayText: null,
          targetText: 'sign the contract',
        },
        {
          position: 2,
          speakerRole: 'speaker_a',
          speakerLabel: null,
          // Stored WITH diacritics, including đ — the half that proves a plain
          // term finds it. Also carries the two LIKE metacharacters.
          sourceText: 'đồng ý 100% rồi',
          displayText: null,
          targetText: 'done, path C:\\Users\\ana',
        },
      ];
      await put(searchable, alice, payload).expect(200);

      dave = await registerAndLogin(app, {
        email: `dave-${run}@conv-db-e2e.example.com`,
      });
      const daves = body();
      daves.turns = [
        {
          position: 0,
          speakerRole: 'speaker_a',
          speakerLabel: null,
          sourceText: 'bao cao ngan sach',
          displayText: 'báo cáo ngân sách',
          targetText: 'the budget report',
        },
      ];
      await put(randomUUID(), dave, daves).expect(200);
    });

    afterAll(async () => {
      await prisma.conversation.deleteMany({ where: { ownerId: dave.userId } });
      await prisma.user.deleteMany({ where: { id: dave.userId } });
    });

    const search = (term: string, who: Identity) =>
      request(app.getHttpServer())
        .get(`/conversations?q=${encodeURIComponent(term)}`)
        .set('authorization', who.bearer);

    const ids = (res: request.Response): string[] =>
      res.body.data.conversations.map(
        (c: { conversationId: string }) => c.conversationId,
      );

    it('finds a conversation by a word in its source text', async () => {
      const res = await search('ngan sach', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it('finds accented text from an unaccented term', async () => {
      // Stored 'đồng ý', typed 'dong y' — the case O1 named, and the one a
      // reader on a keyboard without Vietnamese input actually hits.
      const res = await search('dong y', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it('finds unaccented text from an accented term', async () => {
      // The other direction, which folding only one side would miss: the term
      // carries diacritics and the stored line — a raw recognizer output that
      // was never repaired — does not.
      const res = await search('ký hợp đồng', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it('folds đ, which is a letter rather than a combining mark', async () => {
      // NFD leaves đ alone — it is a distinct letter with a stroke, not a base
      // plus an accent — so it needs its own mapping. Postgres `unaccent` agrees
      // with that mapping, which is what lets the migration backfill old rows.
      const res = await search('đồng', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it('finds a conversation by a word in its repaired display text', async () => {
      // The case that proves search matches what the reader SAW: this phrase
      // exists only in displayText, never in the recognizer's output.
      const res = await search('ngân sách', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it('finds a conversation by a word in its translated text', async () => {
      const res = await search('budget report', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it("does not return another user's conversation that matches the term", async () => {
      // THE IDOR case. An empty list, not a 404: the term matched something, and
      // the honest answer is that the caller has nothing matching it.
      const res = await search('ngân sách', bob).expect(200);
      expect(ids(res)).toEqual([]);
    });

    it('matches case-insensitively', async () => {
      const res = await search('BUDGET Report', alice).expect(200);
      expect(ids(res)).toContain(searchable);
    });

    it('treats a percent sign as a literal', async () => {
      // Unescaped, `%` is a LIKE wildcard and `100%` would match everything.
      const hit = await search('100%', alice).expect(200);
      expect(ids(hit)).toContain(searchable);

      const miss = await search('%zzzz%', alice).expect(200);
      expect(ids(miss)).toEqual([]);
    });

    it('treats a backslash as a literal', async () => {
      // The 500 case. A term ENDING in a backslash is the dangerous shape:
      // escaping `%` and `_` without escaping `\` first leaves a dangling
      // escape, and Postgres answers SQLSTATE 22025 — which the error filter
      // turns into an opaque 500 from one typed character.
      //
      // A backslash on its OWN never reaches SQL: it is one character, under the
      // minimum length, so the boundary refuses it before any query is built.
      await search('\\', alice).expect(400);

      const trailing = await search('x\\', alice);
      expect(trailing.status).toBe(200);
      expect(ids(trailing)).toEqual([]);

      const real = await search('C:\\Users', alice).expect(200);
      expect(ids(real)).toContain(searchable);
    });

    it('refuses a single-character query with 400', async () => {
      // One character matches a large fraction of any transcript, so it returns
      // most of the caller's history rather than answering a question.
      await search('a', alice).expect(400);
      // Whitespace is trimmed first, so a blank term is refused too.
      await search('   ', alice).expect(400);
    });

    it('returns an empty list rather than a 404 when nothing matches', async () => {
      const res = await search('nothing here matches this', alice).expect(200);
      expect(ids(res)).toEqual([]);
      expect(res.body.data.nextCursor).toBeNull();
    });
  });

  function put(
    id: string,
    who: Identity,
    payload: SaveConversationRequest,
  ): request.Test {
    return request(app.getHttpServer())
      .put(`/conversations/${id}`)
      .set('authorization', who.bearer)
      .send(payload);
  }

  async function bootSecondApp(): Promise<INestApplication> {
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const second = fixture.createNestApplication();
    second.useWebSocketAdapter(new WsAdapter(second));
    second.use(requestIdMiddleware);
    await second.init();
    return second;
  }
});

function body(): SaveConversationRequest {
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  return {
    direction: 'vi_to_en' as const,
    startedAt,
    endedAt: new Date().toISOString(),
    turns: [
      {
        position: 0,
        speakerRole: 'speaker_a' as const,
        speakerLabel: 'Ana',
        sourceText: 'xin chao',
        // Present because it differs — the repaired rendering the user read.
        displayText: 'xin chào',
        targetText: 'hello',
      },
      {
        position: 1,
        speakerRole: 'speaker_b' as const,
        speakerLabel: null,
        sourceText: 'khoẻ không',
        displayText: null,
        targetText: 'how are you',
      },
    ],
  };
}

/** An error body with the per-request meta and the echoed id normalized away. */
function comparableError(envelope: {
  success: boolean;
  error: { code: string; message: string };
}): unknown {
  return {
    success: envelope.success,
    error: {
      ...envelope.error,
      message: envelope.error.message.replace(UUID_ANYWHERE, '<id>'),
    },
  };
}

const UUID_ANYWHERE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

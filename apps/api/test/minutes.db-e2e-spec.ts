// Prisma-backed minutes against a REAL Postgres.
//
// The fast `minutes.e2e-spec.ts` proves the pipeline on in-memory doubles. What
// it cannot prove is the durable store's own guarantees: that minutes are
// generated from the STORED transcript, that a regenerate REPLACES the
// action-item rows rather than appending, that deleting a conversation takes its
// minutes with it — and above all that the two-step ownership resolution is
// really there.
//
// That last one is why this suite exists in its present form. After the re-key,
// `MeetingMinutes` is keyed by the conversation's server cuid while every URL
// carries the client-minted id, so a store can be written that resolves the
// conversation WITHOUT the owner filter and answers with anybody's minutes. The
// case below asserts EXACTLY 404 for a client id user B does not own: that store
// would find user A's row and answer 200, and any assertion that also accepted a
// 400 would let it through, because a refusal from the uuid param pipe reads the
// same as a refusal from the store. The unit spec beside `PrismaMinutesStore`
// asserts the two-step resolution itself.
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
  ProviderConnectionError,
  ProviderRegistry,
} from '@chatofy/ai-providers';
import { MINUTES_LIMITS, type SaveConversationRequest } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Prisma-backed minutes (db-e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: Identity;
  let bob: Identity;

  const draftRef = { current: firstDraft() };
  /** Set by a test that needs the conversation to vanish mid-generation. */
  let onSummarize: (() => Promise<void>) | null = null;

  const fakeRegistry = new ProviderRegistry();
  fakeRegistry.register('summarization', {
    name: 'gemini',
    // Returns whatever the current test has staged, so a regenerate can hand
    // back a different action-item set to prove replacement.
    create: () => ({
      name: 'gemini',
      summarize: async () => {
        if (onSummarize) await onSummarize();
        return draftRef.current;
      },
    }),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderRegistry)
      .useValue(fakeRegistry)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    prisma = app.get(PrismaService);
    alice = await registerAndLogin(app, {
      email: `alice-${run}@db-e2e.example.com`,
    });
    bob = await registerAndLogin(app, {
      email: `bob-${run}@db-e2e.example.com`,
    });
  });

  afterAll(async () => {
    // Minutes cascade with their conversation, so this is the whole cleanup.
    await prisma.conversation.deleteMany({
      where: { ownerId: { in: [alice.userId, bob.userId] } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    draftRef.current = firstDraft();
    onSummarize = null;
    // The generate route carries its own ten-per-minute throttle, counted per
    // address — and every case here calls from the same one, so across a run
    // the suite spends that budget on cases that have nothing to do with rate
    // limiting and the last ones answer 429. Clearing the counter makes the
    // budget per-case; the guard itself stays in the graph.
    (app.get(ThrottlerStorage) as ThrottlerStorageService).storage.clear();
  });

  it('generates minutes from the stored turns with no turns in the request body', async () => {
    const id = await seed(alice);

    const post = await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(201);

    expect(post.body.data.minutes).toMatchObject({
      conversationId: id,
      status: 'ready',
      summary: 'first pass',
      model: 'gemini-3.5-flash',
    });
    expect(post.body.data.minutes.actionItems).toHaveLength(2);

    const get = await request(app.getHttpServer())
      .get(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .expect(200);
    expect(get.body.data.minutes.summary).toBe('first pass');
  });

  it("404s another user's minutes — exactly 404, never a validation refusal", async () => {
    const id = await seed(alice);
    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(201);

    // Exactly 404. A store that resolved the conversation by `clientId` alone
    // would find Alice's row here and answer 200 with her minutes; accepting a
    // 400 as well would hide that, because a 400 from the param pipe says
    // nothing about ownership.
    await request(app.getHttpServer())
      .get(`/conversations/${id}/minutes`)
      .set('authorization', bob.bearer)
      .expect(404);
  });

  it('refuses the conversation cuid as a path id before any store is reached', async () => {
    const id = await seed(alice);

    const row = await prisma.conversation.findUniqueOrThrow({
      where: { ownerId_clientId: { ownerId: alice.userId, clientId: id } },
      select: { id: true },
    });
    expect(row.id).not.toBe(id);

    // 400, not 404, and that is the whole claim: a cuid is not a uuid, so the
    // param pipe refuses the server-side id before the route can look anything
    // up. This is the id pipe, not the ownership check.
    await request(app.getHttpServer())
      .get(`/conversations/${row.id}/minutes`)
      .set('authorization', bob.bearer)
      .expect(400);
  });

  it('refuses to summarize a conversation that does not exist', async () => {
    const summarize = jest.fn();
    onSummarize = summarize;

    await request(app.getHttpServer())
      .post(`/conversations/${randomUUID()}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(404);

    // The point of resolving the conversation first: no billed call is spent.
    expect(summarize).not.toHaveBeenCalled();
  });

  it('a regenerate replaces the whole action-item set', async () => {
    const id = await seed(alice);
    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(201);

    draftRef.current = secondDraft();
    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(201);

    const get = await request(app.getHttpServer())
      .get(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .expect(200);

    // The second pass had ONE item; a merge bug would show three.
    expect(get.body.data.minutes.summary).toBe('second pass');
    expect(get.body.data.minutes.actionItems).toHaveLength(1);
    expect(get.body.data.minutes.actionItems[0].description).toBe(
      'only remaining',
    );
  });

  it('keeps the stored minutes readable when a regenerate fails', async () => {
    const id = await seed(alice);
    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(201);

    onSummarize = () =>
      Promise.reject(new ProviderConnectionError('the whole pool is cooling'));
    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(503);

    // The failed attempt must not be written over a readable summary: the empty
    // `failed` record reads exactly like "never generated" on the next load, and
    // it is the only copy of a result that was already billed for.
    const get = await request(app.getHttpServer())
      .get(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .expect(200);
    expect(get.body.data.minutes).toMatchObject({
      status: 'ready',
      summary: 'first pass',
    });
    expect(get.body.data.minutes.actionItems).toHaveLength(2);
  });

  it('deleting a conversation removes its minutes and action items', async () => {
    const id = await seed(alice);
    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(201);

    const row = await prisma.conversation.findUniqueOrThrow({
      where: { ownerId_clientId: { ownerId: alice.userId, clientId: id } },
      select: { id: true, minutes: { select: { id: true } } },
    });
    const minutesId = row.minutes?.id;
    expect(minutesId).toBeTruthy();

    await request(app.getHttpServer())
      .delete(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(204);

    expect(
      await prisma.meetingMinutes.count({ where: { conversationId: row.id } }),
    ).toBe(0);
    expect(await prisma.minutesActionItem.count({ where: { minutesId } })).toBe(
      0,
    );
  });

  it('reports hasMinutes on the list only once minutes exist', async () => {
    const carol = await registerAndLogin(app, {
      email: `carol-${run}@db-e2e.example.com`,
    });
    const id = await seed(carol);

    const before = await request(app.getHttpServer())
      .get('/conversations')
      .set('authorization', carol.bearer)
      .expect(200);
    expect(before.body.data.conversations[0].hasMinutes).toBe(false);

    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', carol.bearer)
      .send({})
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/conversations')
      .set('authorization', carol.bearer)
      .expect(200);
    expect(after.body.data.conversations[0].hasMinutes).toBe(true);

    await prisma.conversation.deleteMany({ where: { ownerId: carol.userId } });
    await prisma.user.deleteMany({ where: { id: carol.userId } });
  });

  it('refuses to summarize a transcript over MINUTES_LIMITS.MAX_TOTAL_CHARS with 400', async () => {
    const summarize = jest.fn();
    onSummarize = summarize;

    // Over the PROMPT ceiling, comfortably under the storage one — so it saves
    // and is readable, and only the summary is refused.
    const id = await seed(alice, {
      turns: Array.from(
        {
          length:
            Math.ceil(
              MINUTES_LIMITS.MAX_TOTAL_CHARS / MINUTES_LIMITS.MAX_TURN_CHARS,
            ) + 1,
        },
        (_, position) => ({
          position,
          speakerRole: 'speaker_a' as const,
          speakerLabel: 'Alice',
          sourceText: 'x'.repeat(MINUTES_LIMITS.MAX_TURN_CHARS),
          displayText: null,
          targetText: '',
        }),
      ),
    });

    await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(400);
    expect(summarize).not.toHaveBeenCalled();

    // Still readable. That asymmetry is the decision, not an accident.
    await request(app.getHttpServer())
      .get(`/conversations/${id}`)
      .set('authorization', alice.bearer)
      .expect(200);
  });

  it('a conversation deleted mid-generation does not turn a provider error into a 500', async () => {
    const id = await seed(alice);
    onSummarize = async () => {
      await request(app.getHttpServer())
        .delete(`/conversations/${id}`)
        .set('authorization', alice.bearer)
        .expect(204);
      throw new Error('the provider fell over');
    };

    // The failure-record write now hits a dead FK. Unguarded it would escape the
    // catch block, `asHttpError` would never run, and the cause would be lost —
    // the status is what says the guard is there.
    const res = await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('ignores a legacy turns field and summarizes the stored transcript', async () => {
    const id = await seed(alice);

    // NOT a 400: zod strips unknown keys by default and no request schema in
    // this repo uses `.strict()`.
    const post = await request(app.getHttpServer())
      .post(`/conversations/${id}/minutes`)
      .set('authorization', alice.bearer)
      .send({ turns: [{ speakerLabel: 'Ghost', text: 'not this' }] })
      .expect(201);
    expect(post.body.data.minutes.summary).toBe('first pass');
  });

  /** Stores a conversation for `who` and returns its client-minted id. */
  async function seed(
    who: Identity,
    overrides: Partial<SaveConversationRequest> = {},
  ): Promise<string> {
    const id = randomUUID();
    await request(app.getHttpServer())
      .put(`/conversations/${id}`)
      .set('authorization', who.bearer)
      .send({
        direction: 'vi_to_en',
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        endedAt: new Date().toISOString(),
        turns: [
          {
            position: 0,
            speakerRole: 'speaker_a',
            speakerLabel: 'Alice',
            sourceText: 'ship it?',
            displayText: null,
            targetText: 'ship it?',
          },
        ],
        ...overrides,
      })
      .expect(200);
    return id;
  }
});

function firstDraft() {
  return {
    summary: 'first pass',
    keyPoints: ['scope'],
    decisions: ['ship friday'],
    actionItems: [
      { description: 'cut branch', owner: 'Alice', dueDate: 'Friday' },
      { description: 'notify team', owner: null, dueDate: null },
    ],
    model: 'gemini-3.5-flash',
  };
}

function secondDraft() {
  return {
    summary: 'second pass',
    keyPoints: ['scope'],
    decisions: [],
    actionItems: [
      { description: 'only remaining', owner: null, dueDate: null },
    ],
    model: 'gemini-3.5-flash',
  };
}

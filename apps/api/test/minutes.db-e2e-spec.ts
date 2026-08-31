// Prisma-backed minutes against a REAL Postgres.
//
// The fast `minutes.e2e-spec.ts` proves the pipeline on the in-memory store.
// What it cannot prove is the durable store's own guarantees — the compound
// unique key that scopes minutes by owner, and that a regenerate actually
// REPLACES the action-item rows rather than appending. Those are exactly what
// this suite exercises, which is why it is split out with a service container of
// its own (run via `pnpm --filter api test:e2e:db`).
//
// Selects the Prisma store for the whole run. Set before any import evaluates
// the config so AppConfigModule reads it.
process.env.MINUTES_STORE_BACKEND = 'prisma';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { ProviderRegistry } from '@chatofy/ai-providers';
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

  const fakeRegistry = new ProviderRegistry();
  fakeRegistry.register('summarization', {
    name: 'gemini',
    // Returns whatever the current test has staged, so a regenerate can hand
    // back a different action-item set to prove replacement.
    create: () => ({
      name: 'gemini',
      summarize: () => Promise.resolve(draftRef.current),
      reduce: () => Promise.resolve(draftRef.current),
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
    await prisma.meetingMinutes.deleteMany({
      where: { ownerId: { in: [alice.userId, bob.userId] } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  const body = { turns: [{ speakerLabel: 'Alice', text: 'ship it?' }] };

  it('round-trips a minutes artifact through Postgres', async () => {
    draftRef.current = firstDraft();
    await request(app.getHttpServer())
      .post('/sessions/db-s1/minutes')
      .set('authorization', alice.bearer)
      .send(body)
      .expect(201);

    const get = await request(app.getHttpServer())
      .get('/sessions/db-s1/minutes')
      .set('authorization', alice.bearer)
      .expect(200);

    expect(get.body.data.minutes).toMatchObject({
      sessionId: 'db-s1',
      status: 'ready',
      summary: 'first pass',
      model: 'gemini-3.5-flash',
    });
    expect(get.body.data.minutes.actionItems).toHaveLength(2);
  });

  it('replaces action items on regenerate rather than appending', async () => {
    draftRef.current = firstDraft();
    await request(app.getHttpServer())
      .post('/sessions/db-s2/minutes')
      .set('authorization', alice.bearer)
      .send(body)
      .expect(201);

    draftRef.current = secondDraft();
    await request(app.getHttpServer())
      .post('/sessions/db-s2/minutes')
      .set('authorization', alice.bearer)
      .send(body)
      .expect(201);

    const get = await request(app.getHttpServer())
      .get('/sessions/db-s2/minutes')
      .set('authorization', alice.bearer)
      .expect(200);

    // The second pass had ONE item; a merge bug would show three.
    expect(get.body.data.minutes.summary).toBe('second pass');
    expect(get.body.data.minutes.actionItems).toHaveLength(1);
    expect(get.body.data.minutes.actionItems[0].description).toBe(
      'only remaining',
    );
  });

  it("does not let another user read the owner's persisted minutes", async () => {
    draftRef.current = firstDraft();
    await request(app.getHttpServer())
      .post('/sessions/db-s3/minutes')
      .set('authorization', alice.bearer)
      .send(body)
      .expect(201);

    await request(app.getHttpServer())
      .get('/sessions/db-s3/minutes')
      .set('authorization', bob.bearer)
      .expect(404);
  });
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

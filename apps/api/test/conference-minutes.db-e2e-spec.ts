import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// Conference minutes against a REAL Postgres.
//
// The unit spec beside `ConferenceMinutesService` proves the access rule and the
// failure semantics on doubles. What it cannot prove is the durable half: that
// the routes answer exactly 404 to somebody who was not in the room even when
// minutes exist, that a regenerate REPLACES the action-item rows rather than
// appending, and that the minutes go when their conference does.
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import {
  ProviderConnectionError,
  ProviderRegistry,
  type MeetingMinutesDraft,
} from '@chatofy/ai-providers';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Conference minutes (db-e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Identity;
  let guest: Identity;
  let stranger: Identity;

  /** What the fake summarizer does next: a draft to return, or an error. */
  const next: { result: () => MeetingMinutesDraft } = {
    result: () => draft('first'),
  };

  const fakeRegistry = new ProviderRegistry();
  fakeRegistry.register('summarization', {
    name: 'gemini',
    create: () => ({
      name: 'gemini',
      summarize: () => Promise.resolve().then(next.result),
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
    owner = await registerAndLogin(app, {
      email: `owner-${run}@db-e2e.example.com`,
    });
    guest = await registerAndLogin(app, {
      email: `guest-${run}@db-e2e.example.com`,
    });
    stranger = await registerAndLogin(app, {
      email: `stranger-${run}@db-e2e.example.com`,
    });
  });

  afterAll(async () => {
    // Participants, turns and minutes all cascade with their conference.
    await prisma.conference.deleteMany({ where: { ownerId: owner.userId } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  beforeEach(() => {
    next.result = () => draft('first');
    // The generate route's ten-per-minute throttle is per address and every
    // case calls from one; see `minutes.db-e2e-spec.ts` on why this reset.
    app.get<ThrottlerStorageService>(ThrottlerStorage).onApplicationShutdown();
  });

  it('lets a participant who is not the owner generate, and everyone in the room read it', async () => {
    const id = await room();

    const empty = await request(app.getHttpServer())
      .get(`/conference/${id}/minutes`)
      .set('authorization', guest.bearer)
      .expect(200);
    expect(empty.body.data.minutes).toBeNull();

    const post = await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', guest.bearer)
      .send({ language: 'vi' })
      .expect(201);
    expect(post.body.data.minutes).toMatchObject({
      conferenceId: id,
      status: 'ready',
      summary: 'first',
    });

    const get = await request(app.getHttpServer())
      .get(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .expect(200);
    expect(get.body.data.minutes).toEqual(post.body.data.minutes);
  });

  it('answers exactly 404 to somebody who was not in the room, on both routes', async () => {
    const id = await room();
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .get(`/conference/${id}/minutes`)
      .set('authorization', stranger.bearer)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', stranger.bearer)
      .send({})
      .expect(404);
  });

  it('refuses a room where nothing was said with 400', async () => {
    const id = await room({ said: [] });

    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .send({})
      .expect(400);
  });

  it('replaces the action items on regenerate rather than appending them', async () => {
    const id = await room();
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .send({})
      .expect(201);

    next.result = () => ({
      ...draft('second'),
      actionItems: [{ description: 'only one', owner: null, dueDate: null }],
    });
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', guest.bearer)
      .send({})
      .expect(201);

    const stored = await prisma.conferenceMinutes.findUniqueOrThrow({
      where: { conferenceId: id },
      include: { actionItems: true },
    });
    expect(stored.summary).toBe('second');
    expect(stored.actionItems.map((a) => a.description)).toEqual(['only one']);
  });

  it('keeps the readable copy when a regenerate fails, and answers 503', async () => {
    const id = await room();
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .send({})
      .expect(201);

    next.result = () => {
      throw new ProviderConnectionError('cooling down');
    };
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', guest.bearer)
      .send({})
      .expect(503);

    const get = await request(app.getHttpServer())
      .get(`/conference/${id}/minutes`)
      .set('authorization', guest.bearer)
      .expect(200);
    expect(get.body.data.minutes).toMatchObject({
      status: 'ready',
      summary: 'first',
    });
  });

  it('records a failed pass when nothing readable was stored', async () => {
    const id = await room();
    next.result = () => {
      throw new ProviderConnectionError('cooling down');
    };

    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .send({})
      .expect(503);

    const get = await request(app.getHttpServer())
      .get(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .expect(200);
    expect(get.body.data.minutes).toMatchObject({ status: 'failed' });
  });

  it('reports when the room started and ended on the detail route', async () => {
    const id = await room();

    const detail = await request(app.getHttpServer())
      .get(`/conference/${id}`)
      .set('authorization', guest.bearer)
      .expect(200);

    expect(detail.body.data.startedAt).toEqual(expect.any(String));
    expect(detail.body.data.endedAt).toEqual(expect.any(String));
  });

  it('deletes the minutes with their conference', async () => {
    const id = await room();
    await request(app.getHttpServer())
      .post(`/conference/${id}/minutes`)
      .set('authorization', owner.bearer)
      .send({})
      .expect(201);

    await prisma.conference.delete({ where: { id } });

    await expect(
      prisma.conferenceMinutes.count({ where: { conferenceId: id } }),
    ).resolves.toBe(0);
  });

  /**
   * An ended room the owner created over HTTP, with the guest as a
   * participant and one turn from each of them unless `said` overrides it.
   */
  async function room(
    { said }: { said: string[] } = { said: ['ship friday?', 'yes'] },
  ): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/conference')
      .set('authorization', owner.bearer)
      .send({})
      .expect(201);
    const id = created.body.data.id as string;

    const speakers = await Promise.all(
      [owner, guest].map((who, i) =>
        prisma.conferenceParticipant.create({
          data: {
            conferenceId: id,
            userId: who.userId,
            displayName: i === 0 ? 'Owner' : 'Guest',
            sourceLanguage: i === 0 ? 'en' : 'vi',
            status: 'left',
          },
          select: { id: true },
        }),
      ),
    );
    for (const [i, text] of said.entries()) {
      await prisma.conferenceTurn.create({
        data: {
          conferenceId: id,
          participantId: speakers[i % 2]!.id,
          sourceLanguage: i % 2 === 0 ? 'en' : 'vi',
          sourceText: text,
        },
      });
    }
    await prisma.conference.update({
      where: { id },
      data: {
        status: 'ended',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
      },
    });
    return id;
  }
});

function draft(summary: string): MeetingMinutesDraft {
  return {
    summary,
    keyPoints: ['scope'],
    decisions: ['ship friday'],
    actionItems: [
      { description: 'cut branch', owner: 'Owner', dueDate: 'Friday' },
      { description: 'notify team', owner: null, dueDate: null },
    ],
    model: 'gemini-3.5-flash',
  };
}

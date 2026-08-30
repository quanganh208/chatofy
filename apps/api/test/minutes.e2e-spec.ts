import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { MINUTES_LIMITS } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full AppModule with the ProviderRegistry overridden by a fake
 * summarizer, so the minutes pipeline (controller → DTO validation → service →
 * store → envelope) runs end-to-end with no real Gemini call and no API key.
 */
describe('Meeting minutes (e2e)', () => {
  let app: INestApplication<App>;
  let alice: Identity;
  let bob: Identity;

  const draft = {
    summary: 'They agreed on the release date.',
    keyPoints: ['scope locked'],
    decisions: ['ship on Friday'],
    actionItems: [
      { description: 'cut the branch', owner: 'Alice', dueDate: 'Friday' },
    ],
    model: 'gemini-3.5-flash',
  };

  // One registry holding only a fake summarization provider. The override
  // replaces the token app-wide; the translate module also receives it but is
  // never exercised here.
  const fakeRegistry = new ProviderRegistry();
  fakeRegistry.register('summarization', {
    name: 'gemini',
    create: () => ({
      name: 'gemini',
      summarize: jest.fn().mockResolvedValue(draft),
    }),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(ProviderRegistry)
      .useValue(fakeRegistry)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    alice = await registerAndLogin(app, { email: 'alice-minutes@example.com' });
    bob = await registerAndLogin(app, { email: 'bob-minutes@example.com' });
  });

  afterAll(async () => {
    await app.close();
  });

  const body = { turns: [{ speakerLabel: 'Alice', text: 'ready to ship?' }] };

  it('generates minutes and reads them back for the owner', async () => {
    const post = await request(app.getHttpServer())
      .post('/sessions/s1/minutes')
      .set('authorization', alice.bearer)
      .send(body)
      .expect(201);

    expect(post.body.success).toBe(true);
    expect(post.body.data.minutes).toMatchObject({
      sessionId: 's1',
      status: 'ready',
      summary: 'They agreed on the release date.',
      model: 'gemini-3.5-flash',
    });
    expect(post.body.data.minutes.actionItems[0].id).toEqual(
      expect.any(String),
    );

    const get = await request(app.getHttpServer())
      .get('/sessions/s1/minutes')
      .set('authorization', alice.bearer)
      .expect(200);
    expect(get.body.data.minutes.summary).toBe(
      'They agreed on the release date.',
    );
  });

  it('404s when the caller has no minutes for the session', async () => {
    const res = await request(app.getHttpServer())
      .get('/sessions/never/minutes')
      .set('authorization', alice.bearer)
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("does not let another user read the owner's minutes (404, not leak)", async () => {
    await request(app.getHttpServer())
      .get('/sessions/s1/minutes')
      .set('authorization', bob.bearer)
      .expect(404);
  });

  it('401s without a bearer token', async () => {
    await request(app.getHttpServer())
      .post('/sessions/s1/minutes')
      .send(body)
      .expect(401);
  });

  it('400s an empty turns array', async () => {
    const res = await request(app.getHttpServer())
      .post('/sessions/s1/minutes')
      .set('authorization', alice.bearer)
      .send({ turns: [] })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('400s a transcript over the total-character ceiling', async () => {
    // Each turn passes its own per-turn cap; the sum is what trips the refine.
    const turn = {
      speakerLabel: 'A',
      text: 'x'.repeat(MINUTES_LIMITS.MAX_TURN_CHARS),
    };
    const count =
      Math.ceil(
        MINUTES_LIMITS.MAX_TOTAL_CHARS / MINUTES_LIMITS.MAX_TURN_CHARS,
      ) + 1;
    const res = await request(app.getHttpServer())
      .post('/sessions/s1/minutes')
      .set('authorization', alice.bearer)
      .send({ turns: Array.from({ length: count }, () => turn) })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

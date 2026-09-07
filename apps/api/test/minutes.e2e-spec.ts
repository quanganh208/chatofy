import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { MINUTES_LIMITS, type ConversationTurn } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { CONVERSATION_STORE } from '../src/modules/conversations/interfaces/conversation-store.interface';
import { MINUTES_STORE } from '../src/modules/minutes/interfaces/minutes-store.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { InMemoryConversationStore } from './utils/in-memory-conversation.store';
import { InMemoryMinutesStore } from './utils/in-memory-minutes.store';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full AppModule with a fake summarizer and no database, so the
 * minutes pipeline (controller → DTO validation → service → store → envelope)
 * runs end-to-end with no real Gemini call, no API key, and no Postgres.
 *
 * BOTH stores are overridden, and that is not belt-and-braces. Minutes are
 * generated from a STORED conversation now, so `MinutesService` reads through
 * `CONVERSATION_STORE` — bound to the Prisma implementation, which injects
 * `PrismaService`. With only the minutes store replaced, every case here would
 * throw on `prisma.conversation`. And a conversation has to be SEEDED, or every
 * generate would answer the 404 it is supposed to answer only for a stranger.
 */
describe('Meeting minutes (e2e)', () => {
  let app: INestApplication<App>;
  let alice: Identity;
  let bob: Identity;

  const conversations = new InMemoryConversationStore();
  const minutesStore = new InMemoryMinutesStore(conversations);

  /** Alice's conversation. Bob's requests for it must answer 404. */
  const conversationId = randomUUID();
  const oversizedId = randomUUID();

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
      summarize: vi.fn().mockResolvedValue(draft),
    }),
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(CONVERSATION_STORE)
      .useValue(conversations)
      .overrideProvider(MINUTES_STORE)
      .useValue(minutesStore)
      .overrideProvider(ProviderRegistry)
      .useValue(fakeRegistry)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();

    alice = await registerAndLogin(app, { email: 'alice-minutes@example.com' });
    bob = await registerAndLogin(app, { email: 'bob-minutes@example.com' });

    await conversations.save(alice.userId, conversationId, {
      direction: 'en_to_vi',
      startedAt: '2026-09-03T00:00:00.000Z',
      endedAt: '2026-09-03T00:10:00.000Z',
      turns: [turn(0, 'ready to ship?')],
    });
    // Under the storage ceiling, over the prompt one — saved and readable, and
    // deliberately not summarizable.
    await conversations.save(alice.userId, oversizedId, {
      direction: 'en_to_vi',
      startedAt: '2026-09-03T00:00:00.000Z',
      endedAt: '2026-09-03T00:10:00.000Z',
      turns: Array.from(
        {
          length:
            Math.ceil(
              MINUTES_LIMITS.MAX_TOTAL_CHARS / MINUTES_LIMITS.MAX_TURN_CHARS,
            ) + 1,
        },
        (_, position) =>
          turn(position, 'x'.repeat(MINUTES_LIMITS.MAX_TURN_CHARS)),
      ),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('generates minutes from the stored turns and reads them back for the owner', async () => {
    const post = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/minutes`)
      .set('authorization', alice.bearer)
      // No turns: the URL names the transcript.
      .send({})
      .expect(201);

    expect(post.body.success).toBe(true);
    expect(post.body.data.minutes).toMatchObject({
      conversationId,
      status: 'ready',
      summary: 'They agreed on the release date.',
      model: 'gemini-3.5-flash',
    });
    expect(post.body.data.minutes.actionItems[0].id).toEqual(
      expect.any(String),
    );

    const get = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/minutes`)
      .set('authorization', alice.bearer)
      .expect(200);
    expect(get.body.data.minutes.summary).toBe(
      'They agreed on the release date.',
    );
  });

  it('ignores a legacy turns field and summarizes the stored transcript', async () => {
    // NOT a 400: zod strips unknown keys by default and no request schema in
    // this repo uses `.strict()`, so an old client is answered rather than
    // refused — with the STORED conversation, never with what it sent.
    const post = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/minutes`)
      .set('authorization', alice.bearer)
      .send({ turns: [{ speakerLabel: 'Ghost', text: 'not this' }] })
      .expect(201);

    expect(post.body.data.minutes.summary).toBe(
      'They agreed on the release date.',
    );
  });

  it('404s when the caller has no minutes for the conversation', async () => {
    const empty = randomUUID();
    await conversations.save(alice.userId, empty, {
      direction: 'en_to_vi',
      startedAt: '2026-09-03T00:00:00.000Z',
      endedAt: '2026-09-03T00:10:00.000Z',
      turns: [turn(0, 'never summarized')],
    });

    const res = await request(app.getHttpServer())
      .get(`/conversations/${empty}/minutes`)
      .set('authorization', alice.bearer)
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("does not let another user read the owner's minutes (404, not leak)", async () => {
    await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/minutes`)
      .set('authorization', bob.bearer)
      .expect(404);
  });

  it('refuses to summarize a conversation the caller does not own', async () => {
    await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/minutes`)
      .set('authorization', bob.bearer)
      .send({})
      .expect(404);
  });

  it('401s without a bearer token', async () => {
    await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/minutes`)
      .send({})
      .expect(401);
  });

  it('400s a non-uuid conversation id', async () => {
    await request(app.getHttpServer())
      .get('/conversations/not-a-uuid/minutes')
      .set('authorization', alice.bearer)
      .expect(400);
  });

  it('400s a transcript over the total-character ceiling', async () => {
    const res = await request(app.getHttpServer())
      .post(`/conversations/${oversizedId}/minutes`)
      .set('authorization', alice.bearer)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

function turn(position: number, sourceText: string): ConversationTurn {
  return {
    position,
    speakerRole: 'speaker_a',
    speakerLabel: 'Alice',
    sourceText,
    displayText: null,
    targetText: 'translated',
  };
}

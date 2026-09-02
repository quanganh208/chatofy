import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY } from '../src/modules/users/interfaces/user-repository.interface';
import { InMemoryUserRepository } from './utils/in-memory-user.repository';
import { registerAndLogin, type Identity } from './utils/auth-fixture';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Boots the full AppModule on the in-memory glossary store (the default) and
 * drives the CRUD + import pipeline end-to-end: controller → DTO validation →
 * service policy → store → envelope. No DB, no API key.
 */
describe('Glossary (e2e)', () => {
  let app: INestApplication<App>;
  let alice: Identity;
  let bob: Identity;

  // The glossary module does not use it, but AppModule boots the minutes and
  // translate modules that resolve through it — the same override minutes.e2e uses.
  const fakeRegistry = new ProviderRegistry();
  fakeRegistry.register('summarization', {
    name: 'gemini',
    create: () => ({ name: 'gemini', summarize: jest.fn() }),
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

    alice = await registerAndLogin(app, {
      email: 'alice-glossary@example.com',
    });
    bob = await registerAndLogin(app, { email: 'bob-glossary@example.com' });
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (id: Identity) => ({ authorization: id.bearer });

  it('401s without a bearer token', async () => {
    await request(app.getHttpServer()).get('/glossary/terms').expect(401);
  });

  it('creates, lists, updates, and deletes a term for the owner', async () => {
    const create = await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'nhồi máu cơ tim', en: 'myocardial infarction' })
      .expect(201);
    expect(create.body.success).toBe(true);
    expect(create.body.data.term).toMatchObject({
      vi: 'nhồi máu cơ tim',
      en: 'myocardial infarction',
      keepVerbatim: false,
    });
    const id = create.body.data.term.id as string;

    const list = await request(app.getHttpServer())
      .get('/glossary/terms')
      .set(auth(alice))
      .expect(200);
    expect(list.body.data.terms).toHaveLength(1);

    const patch = await request(app.getHttpServer())
      .patch(`/glossary/terms/${id}`)
      .set(auth(alice))
      .send({ keepVerbatim: true })
      .expect(200);
    expect(patch.body.data.term.keepVerbatim).toBe(true);

    const del = await request(app.getHttpServer())
      .delete(`/glossary/terms/${id}`)
      .set(auth(alice))
      .expect(200);
    expect(del.body.data.term.id).toBe(id);

    const empty = await request(app.getHttpServer())
      .get('/glossary/terms')
      .set(auth(alice))
      .expect(200);
    expect(empty.body.data.terms).toHaveLength(0);
  });

  it('409s a duplicate (vi, en) pair', async () => {
    await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'dup', en: 'dup' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'dup', en: 'dup' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('400s an empty spelling', async () => {
    const res = await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: '', en: 'x' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('does not leak or mutate another user glossary', async () => {
    const create = await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(bob))
      .send({ vi: 'bobs', en: 'secret' })
      .expect(201);
    const bobId = create.body.data.term.id as string;

    // Alice cannot see bob's term...
    const aliceList = await request(app.getHttpServer())
      .get('/glossary/terms')
      .set(auth(alice))
      .expect(200);
    expect(
      (aliceList.body.data.terms as { vi: string }[]).some(
        (t) => t.vi === 'bobs',
      ),
    ).toBe(false);

    // ...nor patch or delete it (404, not another-user's-resource leak).
    await request(app.getHttpServer())
      .patch(`/glossary/terms/${bobId}`)
      .set(auth(alice))
      .send({ keepVerbatim: true })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/glossary/terms/${bobId}`)
      .set(auth(alice))
      .expect(404);
  });

  it('imports in replace mode, overwriting the caller glossary', async () => {
    await request(app.getHttpServer())
      .post('/glossary/import')
      .set(auth(bob))
      .send({
        mode: 'replace',
        terms: [
          { vi: 'một', en: 'one' },
          { vi: 'hai', en: 'two', keepVerbatim: true },
        ],
      })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.terms).toHaveLength(2);
      });

    const list = await request(app.getHttpServer())
      .get('/glossary/terms')
      .set(auth(bob))
      .expect(200);
    expect(list.body.data.terms).toHaveLength(2);
    expect(
      (list.body.data.terms as { vi: string }[]).some((t) => t.vi === 'bobs'),
    ).toBe(false);
  });
});

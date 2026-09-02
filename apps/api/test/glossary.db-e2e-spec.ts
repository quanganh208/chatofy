// Prisma-backed glossary against a REAL Postgres.
//
// The fast `glossary.e2e-spec.ts` proves the pipeline on the in-memory store.
// What it cannot prove is the durable store's own guarantees — the compound
// unique key that scopes terms by owner and rejects a duplicate pair, and that
// an import in replace mode actually wipes the prior rows. Those are what this
// suite exercises, run via `pnpm --filter api test:e2e:db`.
//
// Selects the Prisma store for the whole run. Set before any import evaluates
// the config so AppConfigModule reads it.
process.env.GLOSSARY_STORE_BACKEND = 'prisma';

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { registerAndLogin, type Identity } from './utils/auth-fixture';

/** Namespaced per run so a reused database does not collide with itself. */
const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe('Prisma-backed glossary (db-e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let alice: Identity;
  let bob: Identity;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    await prisma.glossaryTerm.deleteMany({
      where: { ownerId: { in: [alice.userId, bob.userId] } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  const auth = (id: Identity) => ({ authorization: id.bearer });

  it('round-trips a term through Postgres', async () => {
    const create = await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'thận', en: 'kidney' })
      .expect(201);
    const id = create.body.data.term.id as string;

    const list = await request(app.getHttpServer())
      .get('/glossary/terms')
      .set(auth(alice))
      .expect(200);
    expect(
      (list.body.data.terms as { id: string; vi: string }[]).find(
        (t) => t.id === id,
      ),
    ).toMatchObject({ vi: 'thận', en: 'kidney' });
  });

  it('rejects a duplicate pair at the compound unique key (409)', async () => {
    await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'gan', en: 'liver' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'gan', en: 'liver' })
      .expect(409);
  });

  it("does not let another user read or delete the owner's persisted term", async () => {
    const create = await request(app.getHttpServer())
      .post('/glossary/terms')
      .set(auth(alice))
      .send({ vi: 'phổi', en: 'lung' })
      .expect(201);
    const id = create.body.data.term.id as string;

    await request(app.getHttpServer())
      .delete(`/glossary/terms/${id}`)
      .set(auth(bob))
      .expect(404);
    const bobList = await request(app.getHttpServer())
      .get('/glossary/terms')
      .set(auth(bob))
      .expect(200);
    expect(bobList.body.data.terms).toHaveLength(0);
  });

  it('import replace wipes prior rows; merge upserts keepVerbatim', async () => {
    await request(app.getHttpServer())
      .post('/glossary/import')
      .set(auth(bob))
      .send({ mode: 'replace', terms: [{ vi: 'tim', en: 'heart' }] })
      .expect(200);

    // Merge the same pair with keepVerbatim flipped — one row, updated in place.
    const merged = await request(app.getHttpServer())
      .post('/glossary/import')
      .set(auth(bob))
      .send({
        mode: 'merge',
        terms: [{ vi: 'tim', en: 'heart', keepVerbatim: true }],
      })
      .expect(200);
    expect(merged.body.data.terms).toHaveLength(1);
    expect(merged.body.data.terms[0]).toMatchObject({
      vi: 'tim',
      keepVerbatim: true,
    });

    // Replace again with a different single pair — the prior row is gone.
    const replaced = await request(app.getHttpServer())
      .post('/glossary/import')
      .set(auth(bob))
      .send({ mode: 'replace', terms: [{ vi: 'máu', en: 'blood' }] })
      .expect(200);
    expect(replaced.body.data.terms).toHaveLength(1);
    expect(replaced.body.data.terms[0]).toMatchObject({
      vi: 'máu',
      en: 'blood',
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { userSchema } from '@chatofy/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';

/**
 * Auth against a REAL Postgres.
 *
 * Everything else runs on an in-memory UserRepository, which is fast and proves
 * the controller, argon2 and JWT issuance. What it cannot prove is the storage
 * layer's own guarantees — the unique constraints, and what Prisma actually does
 * on a conflicting write — and those are precisely what the Google linking
 * policy leans on. That is the whole reason this suite is split out and given a
 * service container of its own.
 */
describe('Auth against Postgres (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** Namespaced per run so a reused database does not collide with itself. */
  const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailFor = (name: string) => `${name}-${run}@db-e2e.example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // AppModule carries the gateway; without this Nest looks for socket.io.
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Only this run's rows. Deleting everything would make two concurrent runs
    // — a rerun, a second job — tear down each other's fixtures.
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  const register = (email: string, password = 'a-real-db-password') =>
    request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'DB E2E' });

  it('round-trips register, login and me through real queries', async () => {
    const email = emailFor('roundtrip');
    const created = await register(email).expect(201);
    const userId = created.body.data.user.id as string;

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'a-real-db-password' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${loggedIn.body.data.token.accessToken}`)
      .expect(200);

    expect(me.body.data.id).toBe(userId);
    expect(me.body.data.email).toBe(email);
  });

  it('stores an argon2 hash, and never returns it', async () => {
    const email = emailFor('nohashleak');
    const res = await register(email).expect(201);

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.passwordHash?.startsWith('$argon2')).toBe(true);

    // Strict: a plain parse would ignore an extra passwordHash key rather than
    // reject it, which is the whole failure being guarded against.
    expect(() => userSchema.strict().parse(res.body.data.user)).not.toThrow();
    expect(JSON.stringify(res.body)).not.toContain('$argon2');
  });

  it('creates a Google-first row with a null passwordHash and a googleSub', async () => {
    const email = emailFor('googlefirst');
    await prisma.user.create({
      data: {
        email,
        googleSub: `sub-${run}-first`,
        displayName: 'Google First',
      },
    });

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.passwordHash).toBeNull();
    expect(row?.googleSub).toBe(`sub-${run}-first`);
  });

  it('refuses a second row claiming the same googleSub', async () => {
    // The constraint the linking policy depends on: one Google identity cannot
    // end up attached to two accounts. An in-memory Map cannot prove this.
    const sub = `sub-${run}-unique`;
    await prisma.user.create({
      data: { email: emailFor('sub-a'), googleSub: sub },
    });
    await expect(
      prisma.user.create({
        data: { email: emailFor('sub-b'), googleSub: sub },
      }),
    ).rejects.toThrow();
  });

  it('allows many rows with no googleSub at all', async () => {
    // A UNIQUE column in Postgres does not constrain NULLs, and every
    // password-only account has one. If this ever failed, the second person to
    // register would be refused.
    //
    // Written through Prisma rather than the endpoint: the claim is about the
    // constraint, and the register route is rate limited to 5/min per IP — a
    // suite that spends its budget on rows it does not need starts failing the
    // tests that do need it, which is the throttle working correctly.
    await prisma.user.create({ data: { email: emailFor('nullsub-a') } });
    await prisma.user.create({ data: { email: emailFor('nullsub-b') } });
    const count = await prisma.user.count({
      where: { email: { contains: `nullsub-` }, googleSub: null },
    });
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('refuses a duplicate email at the database, not only in the service', async () => {
    const email = emailFor('dupe');
    await register(email).expect(201);
    await register(email).expect(409);
    // And the constraint holds even if something bypasses the service check.
    await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
  });
});

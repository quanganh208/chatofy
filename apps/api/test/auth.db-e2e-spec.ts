import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
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

  /**
   * Seed a password-bearing row without spending a registration.
   *
   * POST /auth/register is rate limited to 5/min per IP, and every test runs
   * from one address — so a suite that registers rows it is not asserting about
   * starts failing the tests that ARE about registration. That is the throttle
   * working; the fix belongs here.
   */
  const seedWithPassword = async (email: string, password: string) => {
    const passwordHash = await argon2.hash(password);
    return prisma.user.create({
      data: { email, passwordHash, displayName: 'Seeded' },
    });
  };

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
    await seedWithPassword(email, 'already-taken-password');
    await register(email).expect(409);
    // And the constraint holds even if something bypasses the service check.
    await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
  });

  /**
   * The linking policy, against real constraints and real queries.
   *
   * Here rather than in the in-memory suite because this is exactly what a Map
   * cannot prove: the googleSub unique constraint, and what findUnique actually
   * does when two rows compete for one identity.
   */
  describe('Google login', () => {
    /** Stand in for Google. The verifier's own checks are unit-tested. */
    const asGoogle = (payload: Record<string, unknown>) =>
      jest
        .spyOn(OAuth2Client.prototype, 'verifyIdToken')
        .mockResolvedValue({ getPayload: () => payload } as never);

    afterEach(() => jest.restoreAllMocks());

    const googleLogin = () =>
      request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'id.token' });

    it('creates a passwordless account for a new verified identity', async () => {
      const email = emailFor('g-new');
      asGoogle({
        sub: `sub-${run}-new`,
        email,
        email_verified: true,
        name: 'New',
      });

      const res = await googleLogin().expect(200);
      expect(res.body.data.user.email).toBe(email);

      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.passwordHash).toBeNull();
      expect(row?.googleSub).toBe(`sub-${run}-new`);
    });

    it('logs a known googleSub straight in, and does not create a second row', async () => {
      const email = emailFor('g-known');
      const sub = `sub-${run}-known`;
      await prisma.user.create({ data: { email, googleSub: sub } });

      asGoogle({ sub, email, email_verified: true });
      await googleLogin().expect(200);

      expect(await prisma.user.count({ where: { googleSub: sub } })).toBe(1);
    });

    it('links a passwordless row rather than creating a duplicate', async () => {
      const email = emailFor('g-link');
      const created = await prisma.user.create({ data: { email } });

      asGoogle({ sub: `sub-${run}-link`, email, email_verified: true });
      const res = await googleLogin().expect(200);

      expect(res.body.data.user.id).toBe(created.id);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    /**
     * The squatting scenario, end to end.
     *
     * An attacker registers the victim's address — registration proves no
     * mailbox control, since email verification is a non-goal — and the victim
     * later signs in with Google. A naive "verified email, so link" rule would
     * hand the victim a session on the ATTACKER's row, whose password is still
     * there, giving the attacker continued read access to the victim's sessions
     * and the text of their translated meetings. Revocation is a non-goal, so
     * noticing would not even end it.
     */
    it("does not put the victim into the squatter's row", async () => {
      const victimEmail = emailFor('victim');

      // The attacker gets there first, with a password of their choosing.
      await register(victimEmail, 'attacker-chosen-password').expect(201);
      const squatted = await prisma.user.findUnique({
        where: { email: victimEmail },
      });
      expect(squatted?.passwordHash).not.toBeNull();

      // The real owner signs in with Google, verified.
      asGoogle({
        sub: `sub-${run}-victim`,
        email: victimEmail,
        email_verified: true,
      });
      const res = await googleLogin().expect(409);

      expect(res.body.error.code).toBe('CONFLICT');
      // No session was issued, and the row was NOT linked — a later Google
      // login must not walk straight in either.
      expect(res.body.data).toBeUndefined();
      const after = await prisma.user.findUnique({
        where: { email: victimEmail },
      });
      expect(after?.googleSub).toBeNull();
      expect(after?.passwordHash).toBe(squatted?.passwordHash);
    });

    it('refuses an unverified email against an existing row', async () => {
      const email = emailFor('g-unverified');
      await prisma.user.create({ data: { email } });

      asGoogle({ sub: `sub-${run}-unverified`, email, email_verified: false });
      await googleLogin().expect(401);

      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.googleSub).toBeNull();
    });

    it('returns a session shaped exactly like a password login', async () => {
      const email = emailFor('g-shape');
      asGoogle({ sub: `sub-${run}-shape`, email, email_verified: true });
      const viaGoogle = await googleLogin().expect(200);

      const passwordEmail = emailFor('g-shape-pw');
      await seedWithPassword(passwordEmail, 'a-real-db-password');
      const viaPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: passwordEmail, password: 'a-real-db-password' })
        .expect(200);

      expect(Object.keys(viaGoogle.body.data).sort()).toEqual(
        Object.keys(viaPassword.body.data).sort(),
      );
      expect(Object.keys(viaGoogle.body.data.token).sort()).toEqual(
        Object.keys(viaPassword.body.data.token).sort(),
      );
      expect(() =>
        userSchema.strict().parse(viaGoogle.body.data.user),
      ).not.toThrow();
    });
  });
});

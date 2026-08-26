import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import { OAuth2Client } from 'google-auth-library';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  USER_REPOSITORY,
  UserAlreadyExistsError,
  type UserRepository,
} from '../src/modules/users/interfaces/user-repository.interface';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import {
  MAIL_SENDER,
  type MailDispatch,
  type MailSender,
} from '../src/modules/mail/interfaces/mail-sender.interface';
import { PurposeTokenService } from '../src/modules/auth/purpose-token';

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
  let users: UserRepository;
  let tokens: PurposeTokenService;

  /**
   * Every mail the API dispatched, so a test can read the real link out of one.
   *
   * Overridden rather than left as the console sender: the link is the artifact
   * under test, and reading it off stdout would be reading a log line rather
   * than the dispatch itself.
   */
  const sentMail: MailDispatch[] = [];
  const recordingMail: MailSender = {
    send: async (dispatch) => {
      sentMail.push(dispatch);
    },
  };

  /** Namespaced per run so a reused database does not collide with itself. */
  const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailFor = (name: string) => `${name}-${run}@db-e2e.example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_SENDER)
      .useValue(recordingMail)
      .compile();

    app = moduleFixture.createNestApplication();
    // AppModule carries the gateway; without this Nest looks for socket.io.
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
    prisma = app.get(PrismaService);
    users = app.get<UserRepository>(USER_REPOSITORY);
    tokens = app.get(PurposeTokenService);
  });

  beforeEach(() => {
    sentMail.length = 0;
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
      .send({ email, password, name: 'DB E2E' });

  /**
   * Seed a password-bearing row without spending a registration.
   *
   * POST /auth/register is rate limited to 5/min per IP, and every test runs
   * from one address — so a suite that registers rows it is not asserting about
   * starts failing the tests that ARE about registration. That is the throttle
   * working; the fix belongs here.
   */
  /**
   * Lets a detached dispatch land.
   *
   * Sends are deliberately not awaited by the route — awaiting one would make
   * response time an account-existence oracle — so a test that wants to see the
   * mail has to wait for it rather than assume it has already happened.
   */
  const waitForMail = async () => {
    for (let attempt = 0; attempt < 50 && sentMail.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  /** Pulls the `token` query parameter out of a dispatched link. */
  const tokenFromLink = (link: string) =>
    new URL(link).searchParams.get('token') ?? '';

  /**
   * A verification token for an address, minted through the app's own service.
   *
   * Direct rather than by driving `POST /auth/register`, and for the same reason
   * `seedWithPassword` exists: register is 5/60s per IP and every test here comes
   * from one address, so a suite that spends the budget on setup starts failing
   * the tests that are actually about registration. The full
   * register → mail → link → verify chain IS driven end to end, once, in the
   * round-trip test above.
   */
  const verificationTokenFor = (
    email: string,
    password = 'a-real-db-password',
  ) =>
    argon2.hash(password).then((passwordHash) =>
      tokens.issueRegistration({
        email,
        passwordHash,
        name: 'DB E2E',
        locale: 'en',
      }),
    );

  /**
   * A reset token for a seeded row, minted through the app's own service.
   *
   * `POST /auth/forgot-password` is 3/60s per IP — the tightest throttle in the
   * API, because it is the one route whose whole job is to mail an address the
   * caller names. Spending that budget on setup would start failing the tests
   * that are about the route itself, so only the three tests below that actually
   * exercise `forgot-password` call it; every test about REDEEMING a reset mints
   * here instead. Completing the reset still goes through the real endpoint,
   * which is the half that has to be proven end to end.
   *
   * The failure to avoid is someone unblocking this suite by turning the
   * throttler off in e2e, which silently deletes the coverage that auth routes
   * are throttled at all.
   */
  const resetTokenFor = (userId: string, currentPasswordHash: string | null) =>
    tokens.issuePasswordReset(userId, currentPasswordHash);

  const seedWithPassword = async (email: string, password: string) => {
    const passwordHash = await argon2.hash(password);
    return prisma.user.create({
      data: { email, passwordHash, name: 'Seeded' },
    });
  };

  it('round-trips register, verify, login and me through real queries', async () => {
    const email = emailFor('roundtrip');

    // 202 and no session — registering creates nothing.
    const accepted = await register(email).expect(202);
    expect(accepted.body.data.token).toBeUndefined();
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // The link the API actually mailed — not one minted by the test. This is the
    // one place the whole chain is driven end to end.
    await waitForMail();
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!.to).toBe(email);
    expect(sentMail[0]!.link).toContain('/verify-email?token=');

    const verified = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: tokenFromLink(sentMail[0]!.link) })
      .expect(200);
    expect(verified.body.data.token).toBeUndefined();

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).not.toBeNull();

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'a-real-db-password' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${loggedIn.body.data.token.accessToken}`)
      .expect(200);

    expect(me.body.data.id).toBe(row!.id);
    expect(me.body.data.email).toBe(email);
  });

  it('answers a fresh and an already-registered address identically', async () => {
    // The oracle this route exists to close: status and body must not differ,
    // and neither branch may create a row.
    const takenEmail = emailFor('uniform-taken');
    await seedWithPassword(takenEmail, 'a-real-db-password');
    const freshEmail = emailFor('uniform-fresh');

    const fresh = await register(freshEmail).expect(202);
    const taken = await register(takenEmail).expect(202);

    expect(taken.body.data).toEqual(fresh.body.data);
    expect(
      await prisma.user.findUnique({ where: { email: freshEmail } }),
    ).toBeNull();
  });

  it('says the account already exists when a verification link is followed twice', async () => {
    // Ordinary behaviour: mail clients double-click and scanners follow links
    // unasked. Single use falls out of the unique index, not a token table.
    const email = emailFor('doubleclick');
    const token = await verificationTokenFor(email);

    const first = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token })
      .expect(200);

    expect(second.body.data.message).not.toBe(first.body.data.message);
    expect(second.body.data.message).toContain('already exists');
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('stores an argon2 hash, and never returns it', async () => {
    const email = emailFor('nohashleak');
    // Through verification now, since that is what creates the row — and the
    // hash it stores was computed at register time and carried in the token.
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: await verificationTokenFor(email) })
      .expect(200);

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.passwordHash?.startsWith('$argon2')).toBe(true);

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'a-real-db-password' })
      .expect(200);

    // Strict: a plain parse would ignore an extra passwordHash key rather than
    // reject it, which is the whole failure being guarded against.
    expect(() =>
      userSchema.strict().parse(loggedIn.body.data.user),
    ).not.toThrow();
    expect(JSON.stringify(loggedIn.body)).not.toContain('$argon2');
  });

  it('never returns passwordChangedAt, even for a row that carries one', async () => {
    // The column is read on every authenticated request, so the question is
    // whether that read can escape into a payload. Seeded with a value rather
    // than left null: a null would serialize away and prove nothing.
    const email = emailFor('nochangedatleak');
    const seeded = await seedWithPassword(email, 'a-real-db-password');
    await prisma.user.update({
      where: { id: seeded.id },
      data: { passwordChangedAt: new Date('2026-01-01T00:00:00.000Z') },
    });

    const loggedIn = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'a-real-db-password' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${loggedIn.body.data.token.accessToken}`)
      .expect(200);

    // Strict, so an extra key is a failure rather than something the parse
    // quietly drops.
    expect(() => userSchema.strict().parse(me.body.data)).not.toThrow();
    expect(JSON.stringify(me.body)).not.toContain('passwordChangedAt');
  });

  /**
   * The HTTP half of the revocation check, against a timestamp written DIRECTLY
   * through the repository. The reset endpoint's own suite proves that a
   * completed reset writes one — these two must not assert the same fact, or one
   * will be dropped as redundant.
   */
  describe('token revocation', () => {
    const tokenFor = async (email: string, password: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return res.body.data.token.accessToken as string;
    };

    it('refuses a token issued before the password changed', async () => {
      const email = emailFor('revoked');
      const seeded = await seedWithPassword(email, 'a-real-db-password');
      const token = await tokenFor(email, 'a-real-db-password');

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      // Ceiled as the reset path ceils it, plus a second, so the token is
      // unambiguously older than the change.
      await users.updatePasswordHash(
        seeded.id,
        '$argon2-a-new-hash',
        new Date((Math.ceil(Date.now() / 1000) + 1) * 1000),
      );

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('signs nobody out when an unrelated column changes', async () => {
      // `passwordChangedAt` is a dedicated column precisely so this holds.
      // `@updatedAt` would flip on any write, and editing a display name would
      // sign the user out everywhere.
      const email = emailFor('namechange');
      const seeded = await seedWithPassword(email, 'a-real-db-password');
      const token = await tokenFor(email, 'a-real-db-password');

      // Written straight through Prisma rather than through a repository method:
      // what this test is about is the COLUMN, not the route that sets it. Any
      // column other than `passwordChangedAt` proves the same thing, so it does
      // not matter that nothing user-facing writes `name` yet.
      await prisma.user.update({
        where: { id: seeded.id },
        data: { name: 'Renamed' },
      });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(200);
    });

    it("refuses a deleted user's token", async () => {
      const email = emailFor('deleted');
      const seeded = await seedWithPassword(email, 'a-real-db-password');
      const token = await tokenFor(email, 'a-real-db-password');

      await prisma.user.delete({ where: { id: seeded.id } });

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  it('creates a Google-first row with a null passwordHash and a googleSub', async () => {
    const email = emailFor('googlefirst');
    await prisma.user.create({
      data: {
        email,
        googleSub: `sub-${run}-first`,
        name: 'Google First',
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
    // Register no longer reports this — it answers 202 for every address, and
    // creates nothing — so the constraint is what actually holds the line, and
    // it is asserted directly.
    await register(email).expect(202);
    await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
  });

  /**
   * The reset flow, and the revocation it arms.
   *
   * The adapter's own suite proves the CHECK against a directly written column.
   * This proves the WRITE: that completing a reset THROUGH THE ENDPOINT is what
   * makes a previously issued token stop working. The two must not assert the
   * same fact, or one gets dropped as redundant and the half that goes untested
   * is the one only this can prove.
   */
  describe('password reset', () => {
    const forgot = (email: string) =>
      request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email });

    const loginToken = async (email: string, password: string) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return res.body.data.token.accessToken as string;
    };

    it('answers a known and an unknown address identically', async () => {
      const known = emailFor('forgot-known');
      await seedWithPassword(known, 'a-real-db-password');

      const withAccount = await forgot(known).expect(202);
      const without = await forgot(emailFor('forgot-unknown')).expect(202);

      expect(without.body.data).toEqual(withAccount.body.data);
    });

    it('lets Alice@ reset the account stored as alice@', async () => {
      // Without folding, this silently sends nothing — and the answer is uniform
      // either way, so the user just waits for a mail nobody sent.
      const email = emailFor('folded-reset');
      await seedWithPassword(email, 'a-real-db-password');

      await forgot(email.toUpperCase()).expect(202);
      await waitForMail();

      expect(sentMail).toHaveLength(1);
      expect(sentMail[0]!.link).toContain('/reset-password?token=');
    });

    it('changes the password, and refuses the token issued before it', async () => {
      const email = emailFor('reset-revokes');
      const seeded = await seedWithPassword(email, 'a-real-db-password');
      const before = await loginToken(email, 'a-real-db-password');

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${before}`)
        .expect(200);

      const token = await resetTokenFor(seeded.id, seeded.passwordHash);
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, password: 'a-brand-new-password' })
        .expect(200);

      // The old token is dead — written by the ENDPOINT, not by a test poking
      // the column directly. That is the half only this suite can prove.
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${before}`)
        .expect(401);

      // The old password no longer works, and the new one does.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'a-real-db-password' })
        .expect(401);
      await loginToken(email, 'a-brand-new-password');
    });

    it('answers 200 with no session', async () => {
      // Handing back a token here would make it the one credential exempt from
      // the invalidation the reset just performed.
      const email = emailFor('reset-nosession');
      const seeded = await seedWithPassword(email, 'a-real-db-password');

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: await resetTokenFor(seeded.id, seeded.passwordHash),
          password: 'a-brand-new-password',
        })
        .expect(200);

      expect(res.body.data.token).toBeUndefined();
      expect(res.body.data.user).toBeUndefined();
    });

    it('refuses a reset link that has already been spent', async () => {
      const email = emailFor('reset-singleuse');
      const seeded = await seedWithPassword(email, 'a-real-db-password');
      const token = await resetTokenFor(seeded.id, seeded.passwordHash);

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, password: 'a-brand-new-password' })
        .expect(200);

      // Single use falls out of the derivation, not a token table: the new hash
      // derives a different key and this token verifies under neither.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token, password: 'another-new-password' })
        .expect(401);
    });

    it('refuses a password the registration rule would have refused', async () => {
      // The constraint is REFERENCED from the register schema, not restated, so
      // reset cannot set a password registration would not accept.
      const email = emailFor('reset-weak');
      const seeded = await seedWithPassword(email, 'a-real-db-password');

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: await resetTokenFor(seeded.id, seeded.passwordHash),
          password: 'short',
        })
        .expect(400);
    });

    it('leaves a Google-first account able to sign in with Google afterwards', async () => {
      // Reset is deliberately open to a row with no password: only someone
      // holding the mailbox reaches it. Afterwards `loginWithGoogle` still
      // short-circuits at `findByGoogleSub`, so the anti-squatting branch — which
      // keys on a password being present — is never reached.
      const email = emailFor('google-reset');
      const sub = `sub-${run}-google-reset`;
      const row0 = await prisma.user.create({
        data: { email, googleSub: sub },
      });

      // Minted for a NULL hash — the case where a naive key derivation would
      // collapse onto the bare app secret. The `:pwreset:` infix is what keeps
      // this distinct from an access token.
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: await resetTokenFor(row0.id, null),
          password: 'a-brand-new-password',
        })
        .expect(200);

      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.passwordHash).not.toBeNull();
      expect(row?.googleSub).toBe(sub);

      jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
        getPayload: () => ({ sub, email, email_verified: true }),
      } as never);

      await request(app.getHttpServer())
        .post('/auth/google')
        .send({ idToken: 'stand-in-for-a-real-id-token' })
        .expect(200);
    });
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
     * Registering can no longer SET this up — a row exists only once its
     * verification link has been redeemed, so nobody can create an account for
     * an address they do not control. The row is seeded directly here to prove
     * the linking rule still holds for one that arrived some other way: an
     * invite, an import, or a mailbox that was genuinely compromised once.
     *
     * The rule matters because a naive "verified email, so link" would hand the
     * real owner a session on the OTHER row, whose password is still there —
     * giving its holder continued read access to the victim's sessions and the
     * text of their translated meetings.
     */
    it("does not put the victim into the squatter's row", async () => {
      const victimEmail = emailFor('victim');

      await seedWithPassword(victimEmail, 'attacker-chosen-password');
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

    it('refuses to relink a row whose address was recycled to a new Google identity', async () => {
      // A Workspace account is deleted and the same address issued to someone
      // new, who gets a different `sub` for it. Google's durable key is `sub`,
      // not the address — relinking would hand the new holder the previous
      // person's sessions and transcripts. The write is conditional on
      // googleSub still being null, so it is refused at the database, not only
      // by the service's check.
      const email = emailFor('recycled');
      await prisma.user.create({
        data: { email, googleSub: `sub-${run}-previous-holder` },
      });

      asGoogle({ sub: `sub-${run}-new-holder`, email, email_verified: true });
      await googleLogin().expect(409);

      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.googleSub).toBe(`sub-${run}-previous-holder`);
    });

    it('folds address case, so one person does not end up with two accounts', async () => {
      const email = emailFor('folded');
      await prisma.user.create({ data: { email } });

      // Google hands back the address as the user typed it when signing up.
      asGoogle({
        sub: `sub-${run}-folded`,
        email: email.toUpperCase(),
        email_verified: true,
      });
      await googleLogin().expect(200);

      expect(await prisma.user.count({ where: { email } })).toBe(1);
      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.googleSub).toBe(`sub-${run}-folded`);
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

  /**
   * The unique indexes, and what the repository makes of them.
   *
   * `AuthService` turns a duplicate insert into a 409 by catching
   * `UserAlreadyExistsError`, and the repository only raises it if it correctly
   * recognises Prisma's `P2002`. That recognition reads `code` and `meta.target`
   * structurally, which no mock can validate — Prisma has spelled the target as
   * the column and as the index name across versions, and only a real database
   * says which one arrives. Asserted directly rather than through a staged race,
   * because the mapping is the thing in doubt, not the timing.
   */
  describe('a duplicate insert', () => {
    it('is refused on email, and named as such', async () => {
      const email = emailFor('dup-email');
      await users.create({ email, passwordHash: 'not-a-real-hash' });

      const again = users.create({ email, passwordHash: 'not-a-real-hash' });
      await expect(again).rejects.toBeInstanceOf(UserAlreadyExistsError);
      await expect(again).rejects.toMatchObject({ field: 'email' });
    });

    it('is refused on googleSub, and named as such', async () => {
      const googleSub = `sub-${run}-dup`;
      await users.create({ email: emailFor('dup-sub-a'), googleSub });

      // A DIFFERENT email, so only the googleSub index can object — otherwise
      // the assertion below would pass on the wrong constraint.
      const again = users.create({ email: emailFor('dup-sub-b'), googleSub });
      await expect(again).rejects.toBeInstanceOf(UserAlreadyExistsError);
      await expect(again).rejects.toMatchObject({ field: 'googleSub' });
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../src/modules/users/interfaces/user-repository.interface';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import {
  MAIL_SENDER,
  type MailSender,
} from '../src/modules/mail/interfaces/mail-sender.interface';
import { AVATAR_STORAGE } from '../src/modules/storage/interfaces/avatar-storage.interface';
import { DisabledAvatarStorage } from '../src/modules/storage/disabled-avatar-storage';
import {
  REDIS_CLIENT,
  type RedisClient,
} from '../src/modules/redis/redis-client.provider';
import {
  ROTATION_GRACE_SECONDS,
  familyKey,
  hashRefreshToken,
} from '../src/modules/auth/refresh/refresh-token-secret';
import { SessionTerminator } from '../src/modules/auth/session-terminator';
import { RefreshTokenStore } from '../src/modules/auth/refresh/refresh-token.store';

/**
 * Rotation against a REAL Redis and a REAL Postgres.
 *
 * Both are load-bearing. A mocked Lua result proves nothing about atomicity,
 * about what a TTL actually does, or about whether the script's branches are
 * reachable in the order the design assumes — it proves only that a mock agrees
 * with itself. And the password-change gate needs a real user row, which is why
 * these cases belong in the database-backed suite rather than a config of their
 * own.
 *
 * The clock is not mocked and nothing sleeps for the grace window: the script
 * takes `now` as an argument, so a test drives it by writing `spentAt` back in
 * time instead of waiting ten seconds per case.
 */
describe('Refresh token rotation against Redis + Postgres (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let users: UserRepository;
  let redis: RedisClient;

  const silentMail: MailSender = { send: async () => undefined };

  /** Namespaced per run so a reused database does not collide with itself. */
  const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailFor = (name: string) => `${name}-${run}@rotation.example.com`;

  const PASSWORD = 'a-real-rotation-password';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAIL_SENDER)
      .useValue(silentMail)
      .overrideProvider(AVATAR_STORAGE)
      .useValue(new DisabledAvatarStorage())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    app.use(requestIdMiddleware);
    await app.init();
    prisma = app.get(PrismaService);
    users = app.get<UserRepository>(USER_REPOSITORY);
    redis = app.get<RedisClient>(REDIS_CLIENT);
  });

  /** Every family this run minted, so teardown removes its own keys and no others. */
  const mintedFamilies: string[] = [];

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    // Redis is shared with local development, and these records carry a 30-day
    // TTL precisely because that retention IS the reuse detection — so without
    // this every run leaves a month of debris behind. Only this run's families:
    // deleting by pattern would tear down a concurrent run's fixtures.
    if (mintedFamilies.length > 0) {
      await redis.del(mintedFamilies.map(familyKey));
    }
    await app.close();
  });

  /**
   * A user row and a family, WITHOUT spending a login.
   *
   * Login is throttled to 10/min per IP and every case here runs from one
   * loopback address, so a fixture that logged in per test would start failing
   * on the eleventh case — and the temptation would then be to disable the
   * throttler in e2e, silently deleting the coverage that auth routes are
   * throttled at all. The single case below that is actually ABOUT login does
   * log in; everything else asks the store for a family directly, which is the
   * same call login makes.
   */
  const signIn = async (name: string) => {
    const email = emailFor(name);
    const created = await users.create({
      email,
      name: 'Rotation E2E',
      passwordHash: await argon2.hash(PASSWORD),
    });
    const family = await app.get(RefreshTokenStore).issueFamily(created.id);
    mintedFamilies.push(family.familyId);
    return { userId: created.id, email, refreshToken: family.refreshToken };
  };

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  /** The family a token belongs to, read straight out of Redis. */
  const familyIdOf = async (refreshToken: string) =>
    (await redis.hGet(`rt:${hashRefreshToken(refreshToken)}`, 'familyId')) ??
    '';

  /**
   * Ages a spent token past the grace window without sleeping.
   *
   * The script reads `spentAt` from the record and `now` from its arguments, so
   * moving the record backwards is exactly equivalent to waiting — and it keeps
   * a suite of eleven cases from costing two minutes of real time.
   */
  const ageBeyondGrace = async (refreshToken: string) => {
    const key = `rt:${hashRefreshToken(refreshToken)}`;
    const spentAt = Number(await redis.hGet(key, 'spentAt'));
    await redis.hSet(key, {
      spentAt: String(spentAt - ROTATION_GRACE_SECONDS - 5),
    });
  };

  it('issues a refresh token at login, with a fifteen-minute access token', async () => {
    // The one case that drives the real login route, so the whole suite is not
    // asserting against a family nothing in production would have minted.
    const email = emailFor('login-shape');
    await users.create({
      email,
      name: 'Rotation E2E',
      passwordHash: await argon2.hash(PASSWORD),
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    const token = res.body.data.token as {
      refreshToken?: string;
      expiresAt: string;
    };
    mintedFamilies.push(await familyIdOf(token.refreshToken!));
    expect(token.refreshToken).toBeTruthy();
    const lifetimeMs = Date.parse(token.expiresAt) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(13 * 60 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(15 * 60 * 1000);

    // And it really rotates, so this is one continuous proof rather than a
    // shape assertion that could pass against a token nothing accepts.
    await refresh(token.refreshToken!).expect(200);
  });

  it('rotates: the old token stops working and the new one works', async () => {
    const session = await signIn('rotate');

    const first = await refresh(session.refreshToken).expect(200);
    const next = first.body.data.refreshToken as string;
    expect(next).not.toBe(session.refreshToken);

    // The successor works.
    await refresh(next).expect(200);
    // And the token two generations back is now beyond any grace.
    await ageBeyondGrace(session.refreshToken);
    await refresh(session.refreshToken).expect(401);
  });

  it('renews an expired access token, and the renewed one is accepted', async () => {
    const session = await signIn('renew-and-use');

    const renewed = await refresh(session.refreshToken).expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${renewed.body.data.accessToken}`)
      .expect(200);
  });

  describe('the concurrency proof', () => {
    // The highest-severity design error this suite exists to catch. Five tabs
    // firing at once must all end up holding a WORKING token; if any of them
    // ends up with a spent one, that tab is signed out on its next refresh —
    // and at scale that is every user, on every refresh.

    it('serves five simultaneous refreshes of the same token, all usable LATER', async () => {
      const session = await signIn('concurrent');
      const familyId = await familyIdOf(session.refreshToken);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => refresh(session.refreshToken)),
      );

      expect(responses.map((res) => res.status)).toEqual([
        200, 200, 200, 200, 200,
      ]);
      const issued = responses.map(
        (res) => res.body.data.refreshToken as string,
      );
      // Under the re-issue grace model each caller gets its OWN token. They are
      // NOT identical — asserting sameness would be asserting a different
      // design, the one that has to store a plaintext successor to hand back.
      expect(new Set(issued).size).toBe(5);
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('0');

      // THE REAL ASSERTION. A grace branch that followed `replacedBy` and spent
      // the replacement passes everything above and fails right here: only the
      // newest leaf would still be live, so four of these five would read as
      // reuse and take the whole family down with them.
      for (const token of issued) {
        await refresh(token).expect(200);
      }
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('0');
    });
  });

  describe('reuse detection', () => {
    it('refuses an orphaned successor WITHOUT killing the family', async () => {
      // The server cannot tell a lost successor from one the browser is holding
      // — the Redis state is identical — so a late duplicate refresh must cost
      // one re-login on that browser, not this user's meeting on every device.
      const session = await signIn('replay');
      const familyId = await familyIdOf(session.refreshToken);

      const successor = (await refresh(session.refreshToken).expect(200)).body
        .data.refreshToken as string;

      // Forgiven once, which orphans whatever succeeded it.
      await ageBeyondGrace(session.refreshToken);
      await refresh(session.refreshToken).expect(200);

      await refresh(successor).expect(401);
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('0');
    });

    it('never forgives the same orphaned token twice', async () => {
      const session = await signIn('forgive-once');
      const familyId = await familyIdOf(session.refreshToken);

      await refresh(session.refreshToken).expect(200);
      await ageBeyondGrace(session.refreshToken);
      // First late presentation: recovered, a success.
      await refresh(session.refreshToken).expect(200);

      // Second: the family epoch has moved past it, so it is refused — for good,
      // however many times it is presented. Refused, not treated as theft.
      await ageBeyondGrace(session.refreshToken);
      await refresh(session.refreshToken).expect(401);
      await refresh(session.refreshToken).expect(401);
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('0');
    });

    it('trips on a token two generations back', async () => {
      const session = await signIn('two-back');
      const familyId = await familyIdOf(session.refreshToken);

      const second = (await refresh(session.refreshToken).expect(200)).body.data
        .refreshToken as string;
      await refresh(second).expect(200);

      await ageBeyondGrace(session.refreshToken);
      await refresh(session.refreshToken).expect(401);
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('1');
    });

    it('closes that user`s live sockets on a GENERATION regression', async () => {
      // The verdict that is actually provable: a token used after a later
      // generation already was cannot be one browser, because a fresh leaf is
      // not presented again for ~14 minutes. Revoking the family while leaving
      // the thief's socket streaming the victim's audio would be incomplete.
      const session = await signIn('reuse-sockets');
      const familyId = await familyIdOf(session.refreshToken);
      const closed: string[] = [];
      app.get(SessionTerminator).register({
        closeSessionsFor: (userId: string) => {
          closed.push(userId);
          return 1;
        },
      });

      const second = (await refresh(session.refreshToken).expect(200)).body.data
        .refreshToken as string;
      await refresh(second).expect(200);

      await ageBeyondGrace(session.refreshToken);
      await refresh(session.refreshToken).expect(401);

      expect(closed).toContain(session.userId);
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('1');
    });

    it('does NOT close sockets for an orphaned token', async () => {
      const session = await signIn('orphan-sockets');
      const closed: string[] = [];
      app.get(SessionTerminator).register({
        closeSessionsFor: (userId: string) => {
          closed.push(userId);
          return 1;
        },
      });

      const successor = (await refresh(session.refreshToken).expect(200)).body
        .data.refreshToken as string;
      await ageBeyondGrace(session.refreshToken);
      await refresh(session.refreshToken).expect(200);
      await refresh(successor).expect(401);

      expect(closed).not.toContain(session.userId);
    });

    it('keeps a duplicate late refresh from killing a session in use', async () => {
      // The regression this split exists to prevent, end to end: the browser
      // stores its successor, a duplicate of the SAME request arrives past the
      // grace window, and the successor the browser is actively using must not
      // become a theft verdict fourteen minutes later.
      const session = await signIn('late-duplicate');
      const familyId = await familyIdOf(session.refreshToken);

      const held = (await refresh(session.refreshToken).expect(200)).body.data
        .refreshToken as string;
      await ageBeyondGrace(session.refreshToken);
      await refresh(session.refreshToken).expect(200);

      await refresh(held).expect(401);
      // One re-login on this browser. Every other device keeps working.
      expect(await redis.hGet(familyKey(familyId), 'revoked')).toBe('0');
    });
  });

  describe('the session really can be ended', () => {
    it('ends when its family key is deleted by hand', async () => {
      // Success criterion 3, proved at the storage layer: whatever else is
      // true, removing the family from Redis ends the session.
      const session = await signIn('delete-family');
      await redis.del(familyKey(await familyIdOf(session.refreshToken)));

      await refresh(session.refreshToken).expect(401);
    });

    it('refuses a family issued before a password change', async () => {
      // THE REVOCATION GUARANTEE. A refresh token carries no `iat`, so without
      // this gate it would mint a NEW access token with a fresh one and
      // resurrect the session the reset existed to kill.
      const session = await signIn('password-changed');
      await users.updatePasswordHash(
        session.userId,
        await argon2.hash('a-brand-new-password'),
        // Comfortably after the family was issued, so the comparison is not
        // being asked about the same second here — that boundary has its own
        // unit spec.
        new Date(Date.now() + 5000),
      );

      await refresh(session.refreshToken).expect(401);
    });

    it('refuses a deleted user`s family', async () => {
      const session = await signIn('deleted-user');
      await prisma.user.delete({ where: { id: session.userId } });

      await refresh(session.refreshToken).expect(401);
    });
  });

  describe('sign-out', () => {
    it('kills the family, and the token is refused afterwards', async () => {
      const session = await signIn('revoke');

      await request(app.getHttpServer())
        .post('/auth/revoke')
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      await refresh(session.refreshToken).expect(401);
    });

    it('answers 204 for a token it has never seen', async () => {
      // Answering differently would make this an oracle for "is this token
      // still live", and would let a network failure block someone leaving.
      await request(app.getHttpServer())
        .post('/auth/revoke')
        .send({ refreshToken: 'a-token-that-was-never-issued' })
        .expect(204);
    });

    it('does NOT close other devices` sockets', async () => {
      // The difference between a voluntary sign-out and detected theft: signing
      // out of one browser must not drop the user's meeting on another device.
      const session = await signIn('revoke-sockets');
      const closed: string[] = [];
      app.get(SessionTerminator).register({
        closeSessionsFor: (userId: string) => {
          closed.push(userId);
          return 1;
        },
      });

      await request(app.getHttpServer())
        .post('/auth/revoke')
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      expect(closed).not.toContain(session.userId);
    });
  });

  it('refuses a pre-deploy session rather than grandfathering it', async () => {
    // A client carrying a credential minted before this feature has no refresh
    // token at all. It is refused at the first attempt, which IS the deploy
    // migration: everybody signs in once. Grandfathering was rejected because
    // the legacy branch it needs is precisely what strands users on a
    // permanently 401-ing app when it is written wrong.
    await refresh('a-token-from-before-this-feature-existed').expect(401);
  });
});

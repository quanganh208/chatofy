import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { App } from 'supertest/types';
import { authSessionSchema } from '@chatofy/types';
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
  familyKey,
  hashRefreshToken,
  tokenKey,
} from '../src/modules/auth/refresh/refresh-token-secret';
import { AuthService } from '../src/modules/auth/auth.service';
import { PurposeTokenService } from '../src/modules/auth/purpose-token';
import { successBody } from './utils/response-body';

/**
 * Changing a password against a real Postgres and a real Redis.
 *
 * What only this suite can prove is the END-TO-END revocation: that the stamp
 * written by the endpoint refuses every other device's access AND refresh token,
 * while the session the endpoint hands back keeps working on its first use — the
 * one property a unit test over a mocked repository could get right by accident.
 *
 * Its own file, and so its own app, because of the login throttle: login is
 * 10/min per address and `auth.db-e2e-spec.ts` already spends most of that. Every
 * session here is minted through `AuthService.sessionFor`, the same call login
 * makes, and the two cases that are about which password works do log in.
 */
describe('Password change against Postgres + Redis (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let users: UserRepository;
  let redis: RedisClient;

  const silentMail: MailSender = { send: async () => undefined };

  /** Namespaced per run so a reused database does not collide with itself. */
  const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const emailFor = (name: string) => `${name}-${run}@change.example.com`;

  const OLD = 'the-old-password';
  const NEW = 'a-brand-new-password';

  /** Every raw refresh token this run was handed, so teardown removes its own keys. */
  const mintedTokens: string[] = [];

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

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    // Redis is shared with local development and these records live 30 days.
    // Only this run's own keys: each leaf names its family, and a rotation that
    // the gate then refused left a successor reachable only through `replacedBy`.
    const keys = new Set<string>();
    for (const token of mintedTokens) {
      const leaf = tokenKey(hashRefreshToken(token));
      keys.add(leaf);
      const familyId = await redis.hGet(leaf, 'familyId');
      if (familyId) keys.add(familyKey(familyId));
      const replacedBy = await redis.hGet(leaf, 'replacedBy');
      if (replacedBy) keys.add(tokenKey(replacedBy));
    }
    if (keys.size > 0) await redis.del([...keys]);
    await app.close();
  });

  /** The renewable half of a token pair; the contract marks it optional. */
  const refreshOf = (token: { refreshToken?: string }) => {
    if (token.refreshToken === undefined) {
      throw new Error('the session was minted without a refresh token');
    }
    mintedTokens.push(token.refreshToken);
    return token.refreshToken;
  };

  /** A password row, and `devices` independent sessions on it, without a login. */
  const seed = async (
    name: string,
    devices = 1,
    password: string | null = OLD,
  ) => {
    const email = emailFor(name);
    const user = await users.create({
      email,
      name: 'Change E2E',
      ...(password === null
        ? {}
        : { passwordHash: await argon2.hash(password) }),
    });
    const sessions = [];
    for (let i = 0; i < devices; i += 1) {
      const { token } = await app.get(AuthService).sessionFor(user);
      sessions.push({
        accessToken: token.accessToken,
        refreshToken: refreshOf(token),
      });
    }
    return { email, sessions };
  };

  const change = (
    accessToken: string,
    currentPassword: string,
    newPassword = NEW,
  ) =>
    request(app.getHttpServer())
      .post('/auth/change-password')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ currentPassword, newPassword });

  const me = (accessToken: string) =>
    request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${accessToken}`);

  const refresh = (refreshToken: string) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  it('keeps the asking device signed in and signs every other device out', async () => {
    const { email, sessions } = await seed('two-devices', 2);
    const [a, b] = sessions as [
      (typeof sessions)[number],
      (typeof sessions)[number],
    ];

    const res = await change(a.accessToken, OLD).expect(200);
    const replacement = successBody(res, authSessionSchema).data.token;
    const replacementRefresh = refreshOf(replacement);

    // The replacement works on its FIRST use — minted in the stamp's own second,
    // it would otherwise be refused by the change that issued it.
    await me(replacement.accessToken).expect(200);

    // Everything issued before is dead: both devices' access tokens, including
    // the one this very call was made with, and the other device's refresh token.
    await me(a.accessToken).expect(401);
    await me(b.accessToken).expect(401);
    await refresh(b.refreshToken).expect(401);

    // The replacement's refresh half renews, which is what keeps this device
    // signed in past fifteen minutes.
    const renewed = await refresh(replacementRefresh).expect(200);
    const successor = (renewed.body as { data?: { refreshToken?: string } })
      .data?.refreshToken;
    if (successor) mintedTokens.push(successor);

    // The old password no longer signs in; the new one does.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: OLD })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: NEW })
      .expect(200);
    refreshOf(successBody(login, authSessionSchema).data.token);
  });

  it('lets a reset in the same second end the session a change minted', async () => {
    // The change mints its caller a session AT its stamp. A reset completed in
    // that same second would compute the same ceiled stamp, compare equal, and let
    // that session — possibly an attacker's — survive. The repository moves every
    // stamp strictly past the previous one, so this holds whatever the clock does.
    const { email, sessions } = await seed('change-then-reset');
    const [a] = sessions as [(typeof sessions)[number]];

    const res = await change(a.accessToken, OLD).expect(200);
    const replacement = successBody(res, authSessionSchema).data.token;
    refreshOf(replacement);

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    const resetToken = await app
      .get(PurposeTokenService)
      .issuePasswordReset(row.id, row.passwordHash);
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({ token: resetToken, password: 'the-victims-new-password' })
      .expect(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(after.passwordChangedAt!.getTime()).toBeGreaterThan(
      row.passwordChangedAt!.getTime(),
    );
    await me(replacement.accessToken).expect(401);
  });

  it('does not overwrite a password that changed after it was verified', async () => {
    const { email } = await seed('conditional-write');
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });

    const lost = await users.updatePasswordHash(
      row.id,
      '$argon2-from-a-stale-read',
      new Date(),
      '$argon2-not-the-current-hash',
    );
    expect(lost).toBeNull();
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(unchanged.passwordHash).toBe(row.passwordHash);
  });

  it('answers a wrong current password with 403 and leaves the session alive', async () => {
    const { sessions } = await seed('wrong-current');
    const [a] = sessions as [(typeof sessions)[number]];

    // 403, never 401: a 401 tells every client its session is dead.
    await change(a.accessToken, 'not-the-password').expect(403);
    await me(a.accessToken).expect(200);
  });

  it('refuses an account with no password with 409', async () => {
    const { sessions } = await seed('google-only', 1, null);
    const [a] = sessions as [(typeof sessions)[number]];

    await change(a.accessToken, OLD).expect(409);
    await me(a.accessToken).expect(200);
  });

  it('rejects a new password that breaks the rule with 400', async () => {
    const { sessions } = await seed('short-new');
    const [a] = sessions as [(typeof sessions)[number]];

    await change(a.accessToken, OLD, 'short').expect(400);
  });

  it('refuses an unauthenticated call with 401', async () => {
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .send({ currentPassword: OLD, newPassword: NEW })
      .expect(401);
  });

  it('throttles per user, so one account exhausting it leaves another unaffected', async () => {
    // Every request here comes from one loopback address. If the limit were per
    // address — the stock throttler's key — the second user would be refused too.
    const first = await seed('throttled');
    const second = await seed('unthrottled');
    const [a] = first.sessions as [(typeof first.sessions)[number]];
    const [b] = second.sessions as [(typeof second.sessions)[number]];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await change(a.accessToken, 'not-the-password').expect(403);
    }
    await change(a.accessToken, 'not-the-password').expect(429);

    await change(b.accessToken, 'not-the-password').expect(403);
  });
});

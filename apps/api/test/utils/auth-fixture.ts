import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import request from 'supertest';
import { WS_SUBPROTOCOL } from '@chatofy/types';
import { USER_REPOSITORY } from '../../src/modules/users/interfaces/user-repository.interface';
import type { UserRepository } from '../../src/modules/users/interfaces/user-repository.interface';

export interface Identity {
  userId: string;
  email: string;
  accessToken: string;
  /** `Authorization` header value, ready to hand to supertest. */
  bearer: string;
  /** The two subprotocols a WebSocket client offers to authenticate. */
  subprotocols: [string, string];
}

let counter = 0;

/**
 * Seeds a user and returns a token the API really issued.
 *
 * The single sanctioned way a test obtains a credential. Signing one directly
 * would prove a token the API never issued: `POST /auth/login` below drives the
 * actual controller, AuthService, argon2 and the JWT adapter, so if issuance
 * breaks, every suite that needs an identity breaks with it rather than sailing
 * past on a hand-rolled token.
 *
 * ## Why the row is seeded rather than registered
 *
 * `POST /auth/register` no longer returns a session, or an id, or anything that
 * differs between a fresh and an already-registered address — that uniformity is
 * the point of the route, and it means the register response can no longer tell
 * a test who it just created. Registration also creates nothing until its
 * verification link is redeemed, so there would be no row to log in as.
 *
 * Seeding through the injected `USER_REPOSITORY` works identically against
 * `InMemoryUserRepository` under `test:e2e` and Postgres under `test:e2e:db`, so
 * nothing here branches on which store is behind it.
 *
 * It also spends NO register throttle. Register is 5/60s and login 10/60s per
 * IP, and every suite calls from one loopback address — a register-then-login
 * fixture would spend two buckets per identity and start failing the tests that
 * are actually about throttling. The failure to avoid is someone unblocking the
 * suite by disabling `ThrottlerGuard` in e2e, which silently deletes the
 * coverage that auth routes are throttled at all.
 */
export async function registerAndLogin(
  app: INestApplication,
  overrides: { email?: string; password?: string; name?: string } = {},
): Promise<Identity> {
  const email =
    overrides.email ?? `e2e-user-${++counter}-${Date.now()}@example.com`;
  const password = overrides.password ?? 'an-e2e-password';

  const users = app.get<UserRepository>(USER_REPOSITORY);
  const created = await users.create({
    email,
    name: overrides.name ?? 'E2E User',
    // A real argon2 hash, not a placeholder: the login below verifies against
    // it, so a fake would fail exactly where the fixture is supposed to prove
    // that issuance works.
    passwordHash: await argon2.hash(password),
  });

  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  const accessToken = res.body.data.token.accessToken as string;
  return {
    userId: created.id,
    email,
    accessToken,
    bearer: `Bearer ${accessToken}`,
    subprotocols: [WS_SUBPROTOCOL, accessToken],
  };
}

/**
 * A token that is correctly signed and already expired.
 *
 * Minted through the app's own JwtService — same instance, same secret — so
 * this stays the one place `jwt.sign` appears in test code and cannot drift
 * from the secret the app actually verifies against.
 */
export function expiredTokenFor(app: INestApplication, userId: string): string {
  return app.get(JwtService).sign({ sub: userId }, { expiresIn: '-1s' });
}

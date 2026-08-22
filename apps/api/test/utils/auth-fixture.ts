import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { WS_SUBPROTOCOL } from '@chatofy/types';

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
 * Registers a user through the REAL endpoint and returns its token.
 *
 * The single sanctioned way a test obtains a credential. Signing one directly
 * would prove a token the API never issued: this drives the actual controller,
 * AuthService, argon2 and the JWT adapter, so if issuance breaks, every suite
 * that needs an identity breaks with it rather than sailing past on a
 * hand-rolled token.
 */
export async function registerAndLogin(
  app: INestApplication,
  overrides: { email?: string; password?: string; displayName?: string } = {},
): Promise<Identity> {
  const email =
    overrides.email ?? `e2e-user-${++counter}-${Date.now()}@example.com`;
  const password = overrides.password ?? 'an-e2e-password';

  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      email,
      password,
      displayName: overrides.displayName ?? 'E2E User',
    })
    .expect(201);

  const accessToken = res.body.data.token.accessToken as string;
  return {
    userId: res.body.data.user.id as string,
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

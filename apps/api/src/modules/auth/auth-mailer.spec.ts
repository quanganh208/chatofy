import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import {
  forgotPasswordRequestSchema,
  registerRequestSchema,
} from '@chatofy/types';
import { AuthMailer } from './auth-mailer';

const WEB = 'https://chatofy.example';

function mailer() {
  const config = { get: () => WEB } as unknown as ConfigService<never, true>;
  return new AuthMailer({ send: async () => undefined }, config);
}

describe('AuthMailer.link', () => {
  it('builds a web link from the configured origin', () => {
    expect(mailer().link('/verify-email', 'tok')).toBe(
      `${WEB}/verify-email?token=tok`,
    );
    expect(mailer().link('/register')).toBe(`${WEB}/register`);
  });

  it('never carries anything from a token into the origin', () => {
    // The token is a query value; a hostile one cannot change scheme or host.
    const link = mailer().link('/verify-email', '//evil.test/x?y=1');
    expect(link.startsWith(`${WEB}/verify-email?token=`)).toBe(true);
    expect(new URL(link).origin).toBe(WEB);
  });
});

describe('a request from an older app build', () => {
  // Those builds still send `client: 'mobile'`, which used to pick a
  // `chatofy://` link. The field is gone; the request must still be taken.
  it('is accepted, and the client field is dropped', () => {
    const register = registerRequestSchema.parse({
      email: 'a@b.com',
      password: 'a-long-enough-password',
      name: 'A',
      client: 'mobile',
    });
    expect(register).not.toHaveProperty('client');

    const forgot = forgotPasswordRequestSchema.parse({
      email: 'a@b.com',
      client: 'mobile',
    });
    expect(forgot).not.toHaveProperty('client');
  });
});

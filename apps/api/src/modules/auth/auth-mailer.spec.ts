import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { requestClientSchema } from '@chatofy/types';
import { AuthMailer } from './auth-mailer';
import type { MailSender } from '../mail/interfaces/mail-sender.interface';

const WEB = 'https://chatofy.example';

function mailer(scheme = 'chatofy') {
  const values: Record<string, string> = {
    WEB_BASE_URL: WEB,
    MOBILE_LINK_SCHEME: scheme,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<never, true>;
  return new AuthMailer({ send: async () => undefined } as MailSender, config);
}

describe('AuthMailer.link', () => {
  it('builds a web link by default', () => {
    expect(mailer().link('/verify-email', 'tok')).toBe(
      `${WEB}/verify-email?token=tok`,
    );
  });

  it('builds an app link from the configured scheme for the mobile client', () => {
    expect(mailer().link('/verify-email', 'tok', 'mobile')).toBe(
      'chatofy://verify-email?token=tok',
    );
    expect(mailer('chatofy-dev').link('/reset-password', 'tok', 'mobile')).toBe(
      'chatofy-dev://reset-password?token=tok',
    );
  });

  it('names the app screens it differs on', () => {
    expect(mailer().link('/register', undefined, 'mobile')).toBe(
      'chatofy://sign-up',
    );
    expect(mailer().link('/forgot-password', undefined, 'mobile')).toBe(
      'chatofy://forgot-password',
    );
  });

  it('never carries anything from a token into the origin', () => {
    // The token is a query value; a hostile one cannot change scheme or host.
    const link = mailer().link('/verify-email', '//evil.test/x?y=1', 'mobile');
    expect(link.startsWith('chatofy://verify-email?token=')).toBe(true);
    expect(new URL(link).hostname).toBe('verify-email');
  });
});

describe('requestClientSchema', () => {
  it('defaults and coerces to web, so an unknown client gets the safe link', () => {
    expect(requestClientSchema.parse(undefined)).toBe('web');
    expect(requestClientSchema.parse('mobile')).toBe('mobile');
    expect(requestClientSchema.parse('https://evil.test')).toBe('web');
    expect(requestClientSchema.parse(42)).toBe('web');
  });
});

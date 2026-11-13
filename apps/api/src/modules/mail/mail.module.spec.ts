import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted with the mock: `vi.mock` is lifted above every `const` in the file.
const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('nodemailer', () => ({
  createTransport: vi.fn().mockReturnValue({ sendMail }),
}));

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import {
  MailBudgetClass,
  MailPurpose,
} from './interfaces/mail-sender.interface';
import { buildInnerSender, getSmtpConfig } from './mail.module';
import { ConsoleMailSender } from './senders/console-mail.sender';
import { NoopMailSender } from './senders/noop-mail.sender';
import { SmtpMailSender } from './senders/smtp-mail.sender';

function fakeConfig(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

const FULL_SMTP: Partial<Env> = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: 465,
  SMTP_USER: 'me@gmail.com',
  SMTP_PASS: 'app-password',
};

describe('getSmtpConfig', () => {
  it('returns undefined when any of the four SMTP values is missing', () => {
    expect(
      getSmtpConfig(fakeConfig({ SMTP_HOST: 'smtp.gmail.com' })),
    ).toBeUndefined();
  });

  /**
   * The state that actually shipped: an env file carrying `SMTP_USER=` and
   * `SMTP_PASS=`. The variables exist and are the empty string, so the old
   * `=== undefined` check passed them, the production boot gate saw a config,
   * and a real SMTP sender was bound with blank credentials — silently.
   *
   * Blank must be indistinguishable from missing, because missing is the state
   * that fails loudly.
   */
  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const)(
    'treats a present-but-blank %s as unconfigured',
    (key) => {
      expect(
        getSmtpConfig(fakeConfig({ ...FULL_SMTP, [key]: '' })),
      ).toBeUndefined();
      expect(
        getSmtpConfig(fakeConfig({ ...FULL_SMTP, [key]: '   ' })),
      ).toBeUndefined();
    },
  );

  it('treats a blank or non-positive SMTP_PORT as unconfigured', () => {
    for (const port of ['', '   ', 0, -1] as unknown[]) {
      expect(
        getSmtpConfig(fakeConfig({ ...FULL_SMTP, SMTP_PORT: port as number })),
      ).toBeUndefined();
    }
  });

  it('drops a blank MAIL_FROM rather than passing an empty display name', () => {
    expect(
      getSmtpConfig(fakeConfig({ ...FULL_SMTP, MAIL_FROM: '  ' }))?.from,
    ).toBeUndefined();
  });

  it('returns the full config, with MAIL_FROM, when all four are present', () => {
    expect(
      getSmtpConfig(
        fakeConfig({ ...FULL_SMTP, MAIL_FROM: '"Chatofy" <me@gmail.com>' }),
      ),
    ).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'me@gmail.com',
      pass: 'app-password',
      from: '"Chatofy" <me@gmail.com>',
    });
  });
});

describe('buildInnerSender', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['development', 'test'] as const)(
    'selects ConsoleMailSender when NODE_ENV is %s, regardless of SMTP config',
    (nodeEnv) => {
      const sender = buildInnerSender(fakeConfig({ NODE_ENV: nodeEnv }));
      expect(sender).toBeInstanceOf(ConsoleMailSender);
    },
  );

  it('selects SmtpMailSender in production when SMTP is fully configured', () => {
    const sender = buildInnerSender(
      fakeConfig({ NODE_ENV: 'production', ...FULL_SMTP }),
    );
    expect(sender).toBeInstanceOf(SmtpMailSender);
  });

  it("hands the SMTP sender the configured WEB_BASE_URL for the html part's logo", async () => {
    const sender = buildInnerSender(
      fakeConfig({
        NODE_ENV: 'production',
        ...FULL_SMTP,
        WEB_BASE_URL: 'https://chatofy.example.com',
      }),
    );
    // A mobile link: its origin is not one an image could load from, so the
    // logo URL must come from config, never from the link.
    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.PasswordReset,
      budgetClass: MailBudgetClass.Reserved,
      link: 'chatofy://reset-password?token=abc123',
      locale: 'en',
    });
    const call = (sendMail.mock.calls as unknown[][]).at(-1)?.at(0) as {
      html: string;
    };
    expect(call.html).toContain(
      'src="https://chatofy.example.com/email/chatofy-mark@2x.png"',
    );
  });

  it('fails closed to NoopMailSender, with a loud warning, when SMTP is not configured outside development/test', () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const sender = buildInnerSender(fakeConfig({ NODE_ENV: 'production' }));
    expect(sender).toBeInstanceOf(NoopMailSender);
    expect(warnSpy).toHaveBeenCalled();
  });
});

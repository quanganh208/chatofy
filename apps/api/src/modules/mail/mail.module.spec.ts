import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
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
  afterEach(() => jest.restoreAllMocks());

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

  it('fails closed to NoopMailSender, with a loud warning, when SMTP is not configured outside development/test', () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const sender = buildInnerSender(fakeConfig({ NODE_ENV: 'production' }));
    expect(sender).toBeInstanceOf(NoopMailSender);
    expect(warnSpy).toHaveBeenCalled();
  });
});

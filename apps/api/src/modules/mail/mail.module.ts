import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { MAIL_SENDER, MailSender } from './interfaces/mail-sender.interface';
import { ConsoleMailSender } from './senders/console-mail.sender';
import { GuardedMailSender } from './senders/guarded-mail.sender';
import { NoopMailSender } from './senders/noop-mail.sender';
import {
  SmtpMailSender,
  SmtpMailSenderConfig,
} from './senders/smtp-mail.sender';

const logger = new Logger('MailModule');

/**
 * Reads the four SMTP_* values as one unit; `undefined` unless every one is
 * present. Exported so main.ts's production boot check (step 5 of the phase)
 * asks this module the same question it asks itself, instead of restating
 * the "all four present" rule a second time.
 */
export function getSmtpConfig(
  config: ConfigService<Env, true>,
): SmtpMailSenderConfig | undefined {
  const host = config.get('SMTP_HOST', { infer: true });
  const port = config.get('SMTP_PORT', { infer: true });
  const user = config.get('SMTP_USER', { infer: true });
  const pass = config.get('SMTP_PASS', { infer: true });
  if (
    host === undefined ||
    port === undefined ||
    user === undefined ||
    pass === undefined
  ) {
    return undefined;
  }
  return {
    host,
    port,
    user,
    pass,
    from: config.get('MAIL_FROM', { infer: true }),
  };
}

/**
 * Picks the concrete sender: console for development/test, SMTP when fully
 * configured, otherwise a loudly-logging no-op. Fail-closed on purpose — see
 * ConsoleMailSender's doc comment for why this is not `NODE_ENV !== 'production'`.
 * Exported for direct unit testing of the selection logic.
 */
export function buildInnerSender(config: ConfigService<Env, true>): MailSender {
  const nodeEnv = config.get('NODE_ENV', { infer: true });

  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return new ConsoleMailSender();
  }

  const smtpConfig = getSmtpConfig(config);
  if (smtpConfig) {
    return new SmtpMailSender(smtpConfig);
  }

  logger.warn(
    `SMTP is not configured and NODE_ENV=${nodeEnv} is not development/test — ` +
      'binding a no-op mail sender. Every send will be dropped and logged. ' +
      'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS to send real mail.',
  );
  return new NoopMailSender();
}

/**
 * The API's mail seam: exports ONLY MAIL_SENDER, never a concrete sender
 * class or a separate dispatch service.
 *
 * The per-recipient cooldown and the tiered send budget are not a second,
 * skippable service — they are GuardedMailSender, wrapped around whichever
 * concrete sender buildInnerSender picks, and THAT is what gets bound to the
 * token. Injecting MAIL_SENDER is therefore the only way to send mail at
 * all; there is no adjacent seam a caller could reach for and get an
 * unguarded sender by mistake. AuthModule makes the identical argument for
 * AUTH_ADAPTER over JwtAuthAdapter.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailSender =>
        new GuardedMailSender(buildInnerSender(config)),
    },
  ],
  exports: [MAIL_SENDER],
})
export class MailModule {}

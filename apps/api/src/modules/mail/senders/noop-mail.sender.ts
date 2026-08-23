import { Injectable, Logger } from '@nestjs/common';
import { MailDispatch, MailSender } from '../interfaces/mail-sender.interface';

/**
 * The fail-closed fallback for any NODE_ENV that is neither 'development'
 * nor 'test' when SMTP is not fully configured — see mail.module.ts.
 *
 * Silently dropping mail is exactly the failure this class exists to make
 * loud instead of silent: every attempted send logs an operator-visible
 * warning, on top of the one MailModule already logs once at bind time.
 *
 * It THROWS rather than resolving, and that is about the guard wrapping it, not
 * about the caller. `GuardedMailSender` records the per-recipient cooldown and
 * the send budget only after a successful send — precisely so a send that never
 * reached anyone does not burn the user's ten-minute window. Resolving here
 * would defeat that from the inside: a user who received nothing would be told
 * to wait ten minutes before trying again, which is the same failure the
 * record-on-success rule was written to prevent.
 *
 * The HTTP caller is unaffected either way. Every route dispatches detached and
 * answers 202 regardless, so this surfaces in a log and nowhere else.
 */
@Injectable()
export class NoopMailSender implements MailSender {
  private readonly logger = new Logger(NoopMailSender.name);

  async send(dispatch: MailDispatch): Promise<void> {
    this.logger.warn(
      `Mail dropped (purpose=${dispatch.purpose}): no mail sender configured. ` +
        'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS.',
    );
    throw new Error('No mail sender is configured');
  }
}

import { Injectable } from '@nestjs/common';
import {
  buildMailContent,
  MailDispatch,
  MailSender,
} from '../interfaces/mail-sender.interface';

/**
 * Prints the mail to stdout instead of sending it — the entire point of
 * local development without a Gmail account.
 *
 * Bound ONLY when NODE_ENV is exactly 'development' or 'test' — see
 * mail.module.ts. That gate is deliberately NOT `!== 'production'`: NODE_ENV
 * defaults to 'development', so a staging box or a container with it unset
 * would otherwise print live, redeemable account-takeover links to stdout,
 * where CI artifacts, a log aggregator, or a shared terminal can read them.
 *
 * Uses `console.log`, not the Nest Logger, on purpose. This output IS the
 * mail — the dev inbox — not an operational log line, so it is exempt from
 * "no log line contains a link". GuardedMailSender's own Logger calls, which
 * wrap every sender including this one, never repeat this content.
 */
@Injectable()
export class ConsoleMailSender implements MailSender {
  async send(dispatch: MailDispatch): Promise<void> {
    const { subject, text } = buildMailContent(
      dispatch.purpose,
      dispatch.link,
      dispatch.locale,
    );
    console.log(
      `\n──────── mail (${dispatch.purpose}) → ${dispatch.to} ────────\n` +
        `Subject: ${subject}\n\n${text}\n` +
        '───────────────────────────────────────────────────\n',
    );
    return Promise.resolve();
  }
}

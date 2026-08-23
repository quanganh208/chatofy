import { createTransport, Transporter } from 'nodemailer';
import {
  buildMailContent,
  MailDispatch,
  MailSender,
} from '../interfaces/mail-sender.interface';

/** The four values MailModule already checked are present before constructing this. */
export interface SmtpMailSenderConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Display-name override only — see the class comment. */
  from?: string;
}

/**
 * Delivers through Gmail SMTP with an app password (requires 2FA on the
 * account; Google has signalled hostility to app passwords generally — see
 * the plan's risk note, this class is the swap point if they disappear).
 *
 * `From` must resolve to the authenticated SMTP_USER address or Gmail
 * silently rewrites it. MAIL_FROM therefore only rides a display name along,
 * e.g. `"Chatofy" <user@gmail.com>` — it is never a *different* address, and
 * this class does not attempt to enforce that shape; a mismatched MAIL_FROM
 * fails visibly against Gmail's own behaviour rather than this code's.
 *
 * Not @Injectable(): MailModule constructs this only after confirming all
 * four SMTP_* values are present, via a factory — a class-level DI
 * constructor would have nothing to inject when they are absent, which is
 * the common case in dev.
 */
export class SmtpMailSender implements MailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: SmtpMailSenderConfig) {
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      // 465 is Gmail's implicit-TLS submission port for app passwords.
      secure: true,
      auth: { user: config.user, pass: config.pass },
    });
    this.from = config.from ?? config.user;
  }

  async send(dispatch: MailDispatch): Promise<void> {
    const { subject, text } = buildMailContent(dispatch.purpose, dispatch.link);
    await this.transporter.sendMail({
      from: this.from,
      to: dispatch.to,
      subject,
      text,
    });
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import {
  MAIL_SENDER,
  type MailDispatch,
  type MailSender,
} from '../mail/interfaces/mail-sender.interface';

/**
 * How the auth flows send mail: one link builder, one detached dispatch.
 *
 * Extracted from the flows themselves because registration and password
 * recovery both send, and both depend on the two properties below holding
 * IDENTICALLY in every branch. Two copies of `void Promise.resolve().then(...)`
 * is exactly how one of them quietly grows an `await`.
 */
@Injectable()
export class AuthMailer {
  private readonly logger = new Logger(AuthMailer.name);
  private readonly webBaseUrl: string;

  constructor(
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(ConfigService) config: ConfigService<Env, true>,
  ) {
    this.webBaseUrl = config.get('WEB_BASE_URL', { infer: true });
  }

  /**
   * Builds a link into the web app.
   *
   * The origin comes from CONFIGURATION and never from the request — not
   * `req.headers.host`, not `X-Forwarded-Host`. Those are attacker-controlled,
   * and a link built from one is host-header link poisoning: the attacker
   * triggers a reset for a victim, the mail that reaches the victim's real
   * mailbox points at the attacker's origin, and following it hands over a live
   * reset token. Anyone "fixing" a wrong link in a deployment should fix
   * `WEB_BASE_URL`, never reach for the header.
   *
   * This class takes no request object at all, so the header is not merely
   * unused here — it is out of reach.
   */
  link(path: string, token?: string): string {
    const url = new URL(path, this.webBaseUrl);
    if (token !== undefined) url.searchParams.set('token', token);
    return url.toString();
  }

  /**
   * Sends without making the caller wait, and without letting a failure escape.
   *
   * DETACHED ON PURPOSE — this is not a missing `await`. Awaiting a send would
   * make response time the oracle the uniform status code just closed:
   * microseconds for the branch that sends nothing versus up to whole seconds
   * for one that opens an SMTP connection. Anyone adding the `await` back, or a
   * lint rule asking for it, is re-opening an account-existence side channel.
   *
   * The failure is logged and goes no further. The HTTP answer must not vary
   * with whether the mail got out, or it would report which branch ran.
   *
   * Started from a microtask rather than called straight, so NO part of a
   * sender — not even the synchronous head of it, before its first await — runs
   * before the response is built. That also makes every branch that dispatches
   * structurally identical: one branch minting a token first and another calling
   * this directly would otherwise put different amounts of work on the response
   * path, which is the timing difference the uniform status code exists to
   * remove. The flow specs assert nothing has been sent by the time the answer
   * is returned.
   */
  dispatch(dispatch: MailDispatch): void {
    void Promise.resolve()
      .then(() => this.mail.send(dispatch))
      .catch((err: unknown) => {
        this.logger.error(
          `failed to send ${dispatch.purpose} mail: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }

  /**
   * Mints a token in the detached path, then dispatches what it produced.
   *
   * The mint belongs on this side of the `Promise.resolve()` hop, not before it.
   * Calling the token service directly would still run its synchronous head —
   * payload assembly, option validation, key derivation, and now an AES seal —
   * before the caller returns, while the branch that sends a notice runs nothing
   * at all. Both flows have exactly that pair of branches, so both need this.
   */
  dispatchMinted(
    mint: () => Promise<string>,
    build: (token: string) => MailDispatch,
    describe: string,
  ): void {
    void Promise.resolve()
      .then(mint)
      .then((token) => this.dispatch(build(token)))
      .catch((err: unknown) => {
        this.logger.error(
          `failed to mint a ${describe} token: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}

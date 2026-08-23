/**
 * DI injection token — use Symbol to avoid string collision.
 *
 * MailModule exports ONLY this token, never a concrete sender class or a
 * separate dispatch service. The cooldown and the send budget live inside
 * the bound instance (GuardedMailSender), so a caller cannot reach a
 * "cheaper" seam that skips them — see mail.module.ts.
 */
export const MAIL_SENDER = Symbol('MAIL_SENDER');

/**
 * Every kind of mail the product sends. Each purpose maps to a fixed
 * subject/body constant in MAIL_CONTENT below — adding a new purpose means
 * adding its content there before anything can dispatch it. This is what
 * keeps user-supplied text out of a mail body: there is no code path that
 * builds a subject or body from a request field.
 */
export enum MailPurpose {
  VerifyEmail = 'verify-email',
  AccountExistsNotice = 'account-exists-notice',
  NoAccountNotice = 'no-account-notice',
  PasswordReset = 'password-reset',
}

/**
 * Which rolling-24h budget a send draws from — enforced by GuardedMailSender,
 * not by this module. The caller states the class explicitly per send; it is
 * NOT derived from `purpose` here, because which real-world action counts as
 * attacker-triggerable is a fact about the HTTP route calling this seam, not
 * about the mail's content. See guarded-mail.sender.ts for the ceilings.
 *
 * AttackerTriggerable — the caller of the HTTP route names the recipient and
 * needs no proof they control that mailbox, and NO ROW HAS TO EXIST for the
 * send to happen. An address-rotation attacker can trigger these at will, so
 * they share one ceiling and cannot reach past it.
 *
 * Registration's verification mail belongs here, which is worth stating because
 * it is the classification most likely to be "corrected" back. It is sent on
 * `POST /auth/register` for a FRESH address — the caller invented that address
 * and no row exists for it — so it is exactly as attacker-triggerable as the
 * already-registered notice beside it. Put it in Reserved and the rotation
 * attack drains the reserved ceiling through registration, which is the outcome
 * the tiering exists to prevent.
 *
 * Reserved — mail sent only to a row that ALREADY EXISTS, which an attacker
 * therefore cannot conjure by naming addresses: password reset, and nothing
 * else today. This is the only mail a ceiling can genuinely protect, and
 * protecting it is what keeps account recovery working while registration is
 * under attack.
 *
 * ## The residual oracle in this tier, recorded so it is not re-found as new
 *
 * Because `Reserved` is reachable ONLY by naming an address that has an account,
 * its exhaustion is one bit of information about account existence. An attacker
 * holding enough accounts of their own can fill the tier to one below its
 * ceiling, request a reset for a target, then check their own mailbox: no mail
 * means the target's reset consumed the last slot, so the target has an account.
 *
 * That is one bit per rolling 24 hours, and it costs them a number of real,
 * verified accounts equal to the ceiling minus one — each of which now requires
 * control of a distinct mailbox, because registration is verified. It is
 * inherent to ANY budget keyed on row existence, which is what the tiering is;
 * removing it would mean removing the protection. The reclassification above
 * makes it harder, not easier, by raising what the attacker must first spend.
 *
 * Do not "fix" this by failing open when the tier is exhausted — that trades a
 * one-bit-per-day leak for the product-wide account-recovery outage the tier
 * exists to prevent.
 */
export enum MailBudgetClass {
  AttackerTriggerable = 'attacker-triggerable',
  Reserved = 'reserved',
}

/**
 * One outbound mail. `to` is the only piece of caller-controlled data that
 * reaches a header (it has to — it IS the recipient); `link` is the only
 * caller-controlled data that reaches the body, and it must already be a
 * complete, safe URL (built from WEB_BASE_URL, never from a request header —
 * see WEB_BASE_URL in env.schema.ts). Nothing else about the dispatch —
 * no name, no free-form text — is accepted, by construction: this
 * interface has no field for it.
 */
export interface MailDispatch {
  readonly to: string;
  readonly purpose: MailPurpose;
  readonly budgetClass: MailBudgetClass;
  readonly link: string;
}

/**
 * Provider-agnostic mail transport. Implementations: SmtpMailSender (Gmail),
 * ConsoleMailSender (dev/test), NoopMailSender (fail-closed fallback). All
 * three are wrapped by GuardedMailSender before binding to MAIL_SENDER, so
 * every caller of this interface already has the cooldown and budget applied
 * — there is nothing to opt into and nothing to bypass.
 */
export interface MailSender {
  send(dispatch: MailDispatch): Promise<void>;
}

/** Fixed subject/body per purpose. Body is this constant plus the link — nothing else. */
const MAIL_CONTENT: Record<
  MailPurpose,
  (link: string) => { subject: string; text: string }
> = {
  [MailPurpose.VerifyEmail]: (link) => ({
    subject: 'Verify your email address',
    text:
      'Welcome to Chatofy! Confirm this address to finish creating your account:\n\n' +
      `${link}\n\n` +
      'This link expires in 24 hours. If you did not request this, you can ignore this email.',
  }),
  [MailPurpose.AccountExistsNotice]: (link) => ({
    subject: 'You already have a Chatofy account',
    text:
      'An account already exists for this email address. Sign in, or if you ' +
      `forgot your password, reset it here:\n\n${link}\n\n` +
      'If you did not expect this email, you can ignore it.',
  }),
  [MailPurpose.NoAccountNotice]: (link) => ({
    subject: 'No Chatofy account for this address',
    text:
      'Someone asked to reset a Chatofy password for this email address, but no ' +
      'account uses it. If that was you, you may have signed up with a different ' +
      `address — or you can create an account here:\n\n${link}\n\n` +
      'If it was not you, you can ignore this email. Nothing has changed.',
  }),
  [MailPurpose.PasswordReset]: (link) => ({
    subject: 'Reset your Chatofy password',
    text:
      'Use this link to choose a new password:\n\n' +
      `${link}\n\n` +
      'This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.',
  }),
};

/** Builds the subject/body for a dispatch. The single place mail text is composed. */
export function buildMailContent(
  purpose: MailPurpose,
  link: string,
): { subject: string; text: string } {
  return MAIL_CONTENT[purpose](link);
}

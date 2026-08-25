import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AuthMessage,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '@chatofy/types';
import {
  MailBudgetClass,
  MailPurpose,
} from '../mail/interfaces/mail-sender.interface';
import { AuthMailer } from './auth-mailer';
import { normalizeEmail } from './normalize-email';
import { PasswordHasher } from './password-hasher';
import { PurposeTokenService } from './purpose-token';
import { SessionTerminator } from './session-terminator';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import { USER_REPOSITORY } from '../users/interfaces/user-repository.interface';

/**
 * The single answer `POST /auth/forgot-password` gives, for every address.
 *
 * Same reasoning as registration's: a known and an unknown address must be
 * indistinguishable in status, body and — because the send is detached — in
 * response time.
 */
const RESET_REQUESTED =
  'Check your email — if that address has an account, a reset link is on its way.';

/**
 * One message for every unusable reset link — expired, already spent, forged, or
 * naming a row that is gone. Which of those it was is not the holder's business.
 */
const BAD_RESET_LINK = 'That link is invalid or has expired';

/** What a completed reset answers with. No session — the user goes to sign in. */
const PASSWORD_RESET_DONE =
  'Your password has been changed. Sign in with your new password.';

/**
 * Password recovery: request a link, then redeem it.
 *
 * Its own service because it is the one flow that REVOKES. Everything else here
 * grants — a session, an account — while this ends what the old password
 * authorised, across HTTP and open sockets both. Keeping it beside sign-in
 * buried that under a method name; on its own it is the file to read when asking
 * what a reset actually invalidates.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly mailer: AuthMailer,
    private readonly tokens: PurposeTokenService,
    private readonly terminator: SessionTerminator,
  ) {}

  /**
   * Begin a password reset. Answers identically whether or not the address has
   * an account.
   */
  async forgotPassword(dto: ForgotPasswordRequest): Promise<AuthMessage> {
    // NORMALIZED BEFORE THE LOOKUP. Without it `Alice@corp.com` could never
    // reset the row stored as `alice@corp.com` — the same trap login documents,
    // except here the failure is SILENT, because the answer is uniform either
    // way and the user is left waiting for a mail that was never sent.
    const email = normalizeEmail(dto.email);
    const found = await this.users.findCredentialsByEmail(email);

    if (found) {
      // Keyed to the row's CURRENT hash, which is what makes the link die the
      // moment the password changes — see PurposeTokenService.
      this.mailer.dispatchMinted(
        () => this.tokens.issuePasswordReset(found.user.id, found.passwordHash),
        (token) => ({
          to: email,
          purpose: MailPurpose.PasswordReset,
          budgetClass: MailBudgetClass.Reserved,
          link: this.mailer.link('/reset-password', token),
        }),
        'reset',
      );
    } else {
      // Attacker-class: anyone can name any address here and needs no proof they
      // control it, so a rotation attack draws only on the small ceiling and
      // cannot starve the reserved allowance real resets come from.
      this.mailer.dispatch({
        to: email,
        purpose: MailPurpose.NoAccountNotice,
        budgetClass: MailBudgetClass.AttackerTriggerable,
        link: this.mailer.link('/register'),
      });
    }

    return { code: 'RESET_REQUESTED', message: RESET_REQUESTED };
  }

  /**
   * Complete a password reset: set the new hash, and end everything the old one
   * authorised.
   *
   * Answers 200 with NO session. The user goes and signs in — which is also why
   * the ceiling below costs nobody anything: there is no one mid-flight.
   *
   * A row whose `passwordHash` is null — a Google-first account — is deliberately
   * allowed through. Google sign-in is unaffected afterwards, because
   * `loginWithGoogle` short-circuits at `findByGoogleSub` and never reaches the
   * anti-squatting branch, and only someone holding the mailbox can get here —
   * the same proof Google's `emailVerified` attested when the row was created.
   * The HTTP answer does NOT branch on account type; that would be an
   * account-shape oracle.
   */
  async resetPassword(dto: ResetPasswordRequest): Promise<AuthMessage> {
    // The subject has to be read before it can be trusted: deriving the signing
    // key needs that row's current hash, which needs the id, which is inside the
    // token. Nothing from this read is trusted — it selects the row whose hash
    // completes the key, and the verify below decides whether the token is real.
    const claimed = this.tokens.unverifiedSubject(dto.token);
    if (claimed === null) throw new UnauthorizedException(BAD_RESET_LINK);

    const found = await this.users.findCredentialsById(claimed);
    if (!found) throw new UnauthorizedException(BAD_RESET_LINK);

    const userId = await this.tokens.verifyPasswordReset(
      dto.token,
      found.passwordHash,
    );

    // HASHED FIRST, THEN STAMPED. The order is load-bearing and easy to undo by
    // inlining the hash into the call below as an argument.
    //
    // The old password keeps working until the write commits. Anything spent
    // between taking the stamp and committing therefore widens the band of
    // tokens that outlive the reset — and argon2 is ~100 ms of exactly that. A
    // stamp taken before it leaves every login completing in that window holding
    // a token whose `iat` is not older than the recorded second, so it survives
    // the full seven days. Taking the stamp here shrinks that to the write's own
    // latency.
    const passwordHash = await this.hasher.hash(dto.password);

    // CEILED to the next whole second, and the check compares with a strict `<`.
    // `iat` has one-second resolution, so truncating down would leave every
    // token minted during this very second valid for its full seven days — and
    // the person a reset exists to lock out is exactly the one who knows the old
    // password and can poll login to land inside that second. The cost of
    // ceiling is that a login in the same second is refused once and works on
    // retry; nobody is mid-flight, because this returns no session.
    //
    // Stamped from the APP clock — the same one that stamps `iat` — so there is
    // no skew between the two to reason about.
    //
    // Residual, stated rather than implied: a login that completes between this
    // line and the write committing still mints a surviving token. That is the
    // database round trip, single-digit milliseconds, and it needs the attacker
    // to land inside it AND to cross a second boundary. Closing it entirely would
    // need the stamp to come from the committed write itself.
    const changedAt = new Date(Math.ceil(Date.now() / 1000) * 1000);
    await this.users.updatePasswordHash(userId, passwordHash, changedAt);

    // Revocation at the upgrade does not reach a socket that is already open,
    // and no frame re-authenticates — so without this a stolen token keeps
    // streaming the victim's audio and transcripts straight through the reset
    // performed to stop it.
    const closed = this.terminator.terminate(userId);
    if (closed > 0) {
      this.logger.log(`closed ${closed} socket(s) after a password reset`);
    }

    return { code: 'PASSWORD_RESET_DONE', message: PASSWORD_RESET_DONE };
  }
}

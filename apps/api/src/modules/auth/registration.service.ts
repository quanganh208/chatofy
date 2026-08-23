import { Injectable } from '@nestjs/common';
import type {
  AuthMessage,
  RegisterRequest,
  VerifyEmailRequest,
} from '@chatofy/types';
import { VERIFY_EMAIL_MESSAGES } from '@chatofy/types';
import {
  MailBudgetClass,
  MailPurpose,
} from '../mail/interfaces/mail-sender.interface';
import { AuthMailer } from './auth-mailer';
import { normalizeEmail } from './normalize-email';
import { PasswordHasher } from './password-hasher';
import { PurposeTokenService } from './purpose-token';
import { Inject } from '@nestjs/common';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import {
  USER_REPOSITORY,
  UserAlreadyExistsError,
} from '../users/interfaces/user-repository.interface';

/**
 * The single answer `POST /auth/register` gives, for every address.
 *
 * A fresh address and one that already has an account get this byte for byte.
 * The old 409 was an account-existence oracle for the same fact login refuses to
 * reveal, and no wording fixes that — only answering identically does.
 *
 * Phrased as what was DONE, not as what was found: "we have sent you an email"
 * is true in both branches, because both branches send one.
 */
const REGISTRATION_ACCEPTED =
  'Check your email — if we can create an account for that address, a link is on its way.';

/**
 * What a redeemed verification link answers with.
 *
 * Both live in `@chatofy/types` because the web page must tell them apart to
 * render a re-followed link as a notice rather than an error — see the note
 * beside them there before rewording either.
 */
const ACCOUNT_CREATED = VERIFY_EMAIL_MESSAGES.created;

/**
 * What a SECOND redemption of the same verification link answers with.
 *
 * A 200 rather than a conflict, deliberately. Double-clicking a link in a mail
 * client is ordinary, and mail scanners follow links unprompted — the person
 * reading this did nothing wrong and the outcome they wanted has happened. It
 * leaks nothing either: reaching this needs a valid verification token, which
 * only someone who already knows the address can hold.
 */
const ACCOUNT_ALREADY_EXISTS = VERIFY_EMAIL_MESSAGES.alreadyExists;

/**
 * Registration: begun by a form, finished by a mailed link.
 *
 * Its own service rather than more methods on `AuthService`, because it shares
 * nothing with signing in — it mints no session, and the row it eventually
 * creates is described entirely by a token rather than by a request. What the
 * two DO share is hashing, mailing and address folding, and those are the three
 * collaborators injected below.
 */
@Injectable()
export class RegistrationService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly mailer: AuthMailer,
    private readonly tokens: PurposeTokenService,
  ) {}

  /**
   * Begin registration. CREATES NO ACCOUNT.
   *
   * The password is hashed, packed into a signed 24-hour token with the address
   * and name, and mailed as a link. Redeeming that link is what creates
   * the row — so every password account in this system is mailbox-proven by
   * construction, and there is no such thing as an unverified row.
   *
   * ## Why deferred, rather than an unverified row refused at login
   *
   * The obvious design — create the row, block its login with a distinct 403 —
   * REOPENS the existence oracle the uniform answer exists to close, in two
   * unauthenticated requests:
   *
   *   1. register {victim@corp.com, "Attacker1!"} → the same answer either way
   *   2. login    {victim@corp.com, "Attacker1!"} → 403 if the address was FREE
   *      (the attacker's own row now exists and the password matches), 401 if it
   *      was taken
   *
   * The attacker proves account control because they just created the account.
   * The row's existence is the leak, so no wording fixes it. Creating nothing
   * removes it at the root — and takes three other problems with it: login needs
   * no new branch and keeps its single generic 401; there is nothing to squat
   * with, so the Google-linking rule cannot be weaponised to block an address
   * permanently; and no `emailVerified` column exists to backfill.
   */
  async register(dto: RegisterRequest): Promise<AuthMessage> {
    const email = normalizeEmail(dto.email);

    // HASHED BEFORE THE EXISTENCE CHECK, AND THAT ORDER IS A TIMING DEFENCE.
    //
    // It looks like waste — why spend ~100 ms of argon2 on an address that
    // already has an account? Because the alternative is a timing oracle
    // replacing the status one: the fresh branch would pay for a hash and the
    // taken branch would pay nothing, and the difference is measurable from
    // outside. This is the same care `PasswordHasher.dummy()` applies to login.
    //
    // `registration.service.spec.ts` asserts the ORDER of these two calls, not
    // elapsed time — a wall-clock assertion either flakes on a shared runner
    // (argon2 is 64 MiB on the same threadpool as the translate pipeline) or
    // uses an epsilon that proves nothing, and a flaky security test gets
    // skipped, which is worse than no test.
    const passwordHash = await this.hasher.hash(dto.password);
    const existing = await this.users.findByEmail(email);

    if (existing) {
      // Mailed rather than silently dropped: this serves the person who forgot
      // they already registered. It is also the class of mail an attacker can
      // trigger at will by naming any address, so it draws from the small
      // ceiling rather than from the allowance real verifications need.
      this.mailer.dispatch({
        to: email,
        purpose: MailPurpose.AccountExistsNotice,
        budgetClass: MailBudgetClass.AttackerTriggerable,
        link: this.mailer.link('/forgot-password'),
      });
    } else {
      this.mailer.dispatchMinted(
        () =>
          this.tokens.issueRegistration({
            email,
            passwordHash,
            name: dto.name,
          }),
        (token) => ({
          to: email,
          purpose: MailPurpose.VerifyEmail,
          // ATTACKER-CLASS, like the notice above, and for the same reason:
          // this address is one the caller invented, and no row exists for it.
          // Drawing on the reserved allowance would let someone registering
          // rotating fresh addresses at this route's 5/60s drain it in about
          // eighty minutes — after which nobody could RESET a password either,
          // while every route still answered 202. Reserved is for mail that
          // can only be sent to a row that already exists.
          budgetClass: MailBudgetClass.AttackerTriggerable,
          link: this.mailer.link('/verify-email', token),
        }),
        'verification',
      );
    }

    // One message, both branches. There is no resend endpoint: submitting this
    // form again IS the resend, and it is idempotent from the caller's side.
    return { message: REGISTRATION_ACCEPTED };
  }

  /**
   * Redeem a verification link — the step that actually creates the account.
   *
   * Single use falls out of the unique index rather than out of a token table:
   * the first redemption inserts the row, and a second loses to
   * `UserAlreadyExistsError`, which is answered as the plain fact that the
   * account exists.
   */
  async verifyEmail(dto: VerifyEmailRequest): Promise<AuthMessage> {
    const pending = await this.tokens.readRegistration(dto.token);

    try {
      // Field by field, never `{ ...pending }`. The token's payload is decoded
      // input, and spreading it into `create` would let anything that ever gets
      // added to that payload become a column a link can set.
      await this.users.create({
        email: pending.email,
        name: pending.name,
        passwordHash: pending.passwordHash,
      });
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        return { message: ACCOUNT_ALREADY_EXISTS };
      }
      // Anything else — a dropped connection, a column that does not exist — is
      // a real fault and keeps its identity. It must NOT be reported as a bad
      // link, which would send the user round a loop that cannot succeed.
      throw err;
    }

    return { message: ACCOUNT_CREATED };
  }
}

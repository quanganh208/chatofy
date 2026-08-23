import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleTokenVerifier } from './google-token-verifier';
import * as argon2 from 'argon2';
import type {
  AuthMessage,
  AuthSession,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  User,
  VerifyEmailRequest,
} from '@chatofy/types';
import { VERIFY_EMAIL_MESSAGES } from '@chatofy/types';
import type { Env } from '../../config/env.schema';
import {
  MAIL_SENDER,
  MailBudgetClass,
  MailPurpose,
  type MailDispatch,
  type MailSender,
} from '../mail/interfaces/mail-sender.interface';
import { PurposeTokenService } from './purpose-token';
import { SessionTerminator } from './session-terminator';
import { toUserContract } from '../users/mappers/to-user.mapper';
import type {
  UserRecord,
  UserRepository,
} from '../users/interfaces/user-repository.interface';
import {
  USER_REPOSITORY,
  UserAlreadyExistsError,
} from '../users/interfaces/user-repository.interface';
import {
  AUTH_ADAPTER,
  type AuthAdapter,
} from './interfaces/auth-adapter.interface';

/** Token lifetime, mirrored from JwtModule so `expiresAt` and `exp` agree. */
export const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * An argon2 hash of a value no password equals, verified against when the email
 * is unknown.
 *
 * Without it, "no such user" returns in microseconds while "wrong password"
 * spends a full argon2 verify — a timing difference that answers the exact
 * question the generic error message exists to refuse. The cost of answering
 * every unknown email at argon2 speed is what the route's rate limit bounds.
 *
 * Computed once at module load rather than per request; it hashes a constant, so
 * a fresh one each time would only burn 64 MiB to reach the same conclusion.
 */
const DUMMY_HASH_PROMISE = argon2
  .hash('a password no account has')
  // Handled at creation, not at first use. Nothing awaits this until the first
  // login for an unknown email, which may never happen — and an unhandled
  // rejection (argon2 failing to load its native binding on a deploy target,
  // the very case the hasher seam exists for) would end the process under Node
  // 24's default --unhandled-rejections=throw. Rethrown on await instead, where
  // it becomes one failed login.
  .catch((err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  });

/** One message and one status for every failed login. */
const LOGIN_FAILED = 'Invalid email or password';

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
 * The single answer `POST /auth/forgot-password` gives, for every address.
 *
 * Same reasoning as above, and the same requirement: a known and an unknown
 * address must be indistinguishable in status, body and — because the send is
 * detached — in response time.
 */
const RESET_REQUESTED =
  'Check your email — if that address has an account, a reset link is on its way.';

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
 * One message for every unusable reset link — expired, already spent, forged, or
 * naming a row that is gone. Which of those it was is not the holder's business.
 */
const BAD_RESET_LINK = 'That link is invalid or has expired';

/** What a completed reset answers with. No session — the user goes to sign in. */
const PASSWORD_RESET_DONE =
  'Your password has been changed. Sign in with your new password.';

/**
 * The form an address is stored and compared in.
 *
 * Neither `z.email()` nor Postgres's default collation folds case, so without
 * this someone who registers `Alice@corp.com` cannot log in as
 * `alice@corp.com` — they get the generic failure, indistinguishable from a
 * wrong password, with no way to find out why. Worse for Google: the lookup
 * misses the row entirely and silently creates a SECOND account for the same
 * person.
 *
 * Applied at this boundary rather than in the shared request schema, so the
 * wire contract keeps describing what a client may send while the service owns
 * what identity means. Only the domain would be case-insensitive by RFC; the
 * local part is folded too because every provider this targets treats it that
 * way and a split identity is the worse failure.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly webBaseUrl: string;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    private readonly google: GoogleTokenVerifier,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    private readonly tokens: PurposeTokenService,
    private readonly terminator: SessionTerminator,
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
   */
  private webLink(path: string, token?: string): string {
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
   * remove. `auth.service.spec.ts` asserts nothing has been sent by the time the
   * answer is returned.
   */
  private dispatchMail(dispatch: MailDispatch): void {
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
   * Hashing lives behind these two methods and nowhere else, so swapping argon2
   * for bcryptjs — the fallback if a deploy target cannot build a native module
   * — stays a change to this file alone.
   */
  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  private async verifyPassword(
    hash: string,
    password: string,
  ): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A stored value argon2 cannot parse is a corrupt row, not a match.
      return false;
    }
  }

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
    // outside. This is the same care `DUMMY_HASH_PROMISE` applies to login.
    //
    // `auth.service.spec.ts` asserts the ORDER of these two calls, not elapsed
    // time — a wall-clock assertion either flakes on a shared runner (argon2 is
    // 64 MiB on the same threadpool as the translate pipeline) or uses an
    // epsilon that proves nothing, and a flaky security test gets skipped, which
    // is worse than no test.
    const passwordHash = await this.hashPassword(dto.password);
    const existing = await this.users.findByEmail(email);

    if (existing) {
      // Mailed rather than silently dropped: this serves the person who forgot
      // they already registered. It is also the class of mail an attacker can
      // trigger at will by naming any address, so it draws from the small
      // ceiling rather than from the allowance real verifications need.
      this.dispatchMail({
        to: email,
        purpose: MailPurpose.AccountExistsNotice,
        budgetClass: MailBudgetClass.AttackerTriggerable,
        link: this.webLink('/forgot-password'),
      });
    } else {
      // Minted inside the detached path, not before it, so neither branch does
      // more work than the other on the way to the response. The
      // `Promise.resolve()` hop is what makes that literally true rather than
      // nearly true: calling `issueRegistration` directly would still run its
      // synchronous head — payload assembly, option validation, key
      // concatenation — before this function returns, and the other branch runs
      // nothing at all.
      void Promise.resolve()
        .then(() =>
          this.tokens.issueRegistration({
            email,
            passwordHash,
            name: dto.name,
          }),
        )
        .then((token) => {
          this.dispatchMail({
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
            link: this.webLink('/verify-email', token),
          });
        })
        .catch((err: unknown) => {
          this.logger.error(
            `failed to mint a verification token: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
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
      // Deferred the same way register's mint is, and for the same reason: the
      // other branch of this method runs nothing synchronously before returning,
      // so this one must not either.
      void Promise.resolve()
        .then(() =>
          this.tokens.issuePasswordReset(found.user.id, found.passwordHash),
        )
        .then((token) => {
          this.dispatchMail({
            to: email,
            purpose: MailPurpose.PasswordReset,
            budgetClass: MailBudgetClass.Reserved,
            link: this.webLink('/reset-password', token),
          });
        })
        .catch((err: unknown) => {
          this.logger.error(
            `failed to mint a reset token: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    } else {
      // Attacker-class: anyone can name any address here and needs no proof they
      // control it, so a rotation attack draws only on the small ceiling and
      // cannot starve the reserved allowance real resets come from.
      this.dispatchMail({
        to: email,
        purpose: MailPurpose.NoAccountNotice,
        budgetClass: MailBudgetClass.AttackerTriggerable,
        link: this.webLink('/register'),
      });
    }

    return { message: RESET_REQUESTED };
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
    const passwordHash = await this.hashPassword(dto.password);

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

    return { message: PASSWORD_RESET_DONE };
  }

  async login(dto: LoginRequest): Promise<AuthSession> {
    const found = await this.users.findCredentialsByEmail(
      normalizeEmail(dto.email),
    );

    // Both misses cost the same and say the same thing: an unknown email is
    // verified against the dummy hash, and a Google-first row with no password
    // takes that path too rather than admitting it exists but has no password.
    const hash = found?.passwordHash ?? (await DUMMY_HASH_PROMISE);
    const matches = await this.verifyPassword(hash, dto.password);

    if (!found || found.passwordHash === null || !matches) {
      throw new UnauthorizedException(LOGIN_FAILED);
    }
    return this.sessionFor(found.user);
  }

  /**
   * Sign in with Google, creating or linking an account.
   *
   * The policy is hardened in BOTH directions, and the second one is the reason
   * this is not three lines:
   *
   *   provider -> local  a Google identity must not attach to a row whose email
   *                      Google has not verified.
   *   local -> provider  a Google identity must not attach to a row that
   *                      already has a password.
   *
   * The second is now belt AND braces, and worth keeping as both. Registration
   * proves mailbox control — a row only exists once a verification link has been
   * redeemed — so the squatting scenario this defends against can no longer be
   * set up: nobody can create an account for victim@company.com without holding
   * that mailbox. But the rule costs nothing, it is the last thing standing
   * between a compromised mailbox and a silent account takeover, and were it
   * removed, whoever did own such a row would keep read access to the victim's
   * sessions and the full text of their translated meetings until the victim
   * reset the password — which is what now ends it, since a completed reset
   * invalidates outstanding tokens and closes open sockets.
   *
   * So a row with a passwordHash is never auto-linked. Attaching Google to it
   * requires proving password control first, which is a flow this does not
   * offer and refuses clearly instead of guessing.
   */
  async loginWithGoogle(idToken: string): Promise<AuthSession> {
    const identity = await this.google.verify(idToken);

    // 1. Known Google identity. `googleSub` is unique and never reassigned, so
    //    this needs no email check at all.
    const linked = await this.users.findByGoogleSub(identity.sub);
    if (linked) return this.sessionFor(linked);

    const email = normalizeEmail(identity.email);
    const existing = await this.users.findCredentialsByEmail(email);

    // 3. Nobody by that email: a fresh, passwordless account.
    if (!existing) {
      if (!identity.emailVerified) {
        throw new UnauthorizedException(
          'Google has not verified that email address',
        );
      }
      // Same race as register, reached only on an account's FIRST Google
      // sign-in — every later one returns at the `findByGoogleSub` above. The
      // loser is told to retry rather than that something is wrong, because a
      // retry genuinely works: the winner's row now carries this `sub`, so the
      // next attempt matches at step 1 and signs in.
      try {
        const created = await this.users.create({
          email,
          googleSub: identity.sub,
          ...(identity.name ? { name: identity.name } : {}),
        });
        return this.sessionFor(created);
      } catch (err) {
        if (err instanceof UserAlreadyExistsError) {
          throw new ConflictException(
            'Another sign-in for that account finished first — try again',
          );
        }
        throw err;
      }
    }

    // 2b. The squatting defence. Someone proved password control of this row —
    //     or claims to have — and a Google id_token is not evidence against it.
    if (existing.passwordHash !== null) {
      throw new ConflictException(
        'An account with that email already has a password. Sign in with your password to link Google.',
      );
    }

    // 2c. Unverified email against an existing row: refused outright.
    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Google has not verified that email address',
      );
    }

    // 2d. Already linked to a DIFFERENT Google identity. Reached when an
    //     address is recycled — a Workspace account deleted and the same
    //     address issued to someone new, who gets a new `sub` for it. Google's
    //     durable key is `sub`, not the address, so overwriting here would hand
    //     the new holder the previous person's account, sessions and
    //     transcripts. Refused rather than relinked.
    if (existing.googleSub !== null && existing.googleSub !== identity.sub) {
      throw new ConflictException(
        'That email is already linked to a different Google account',
      );
    }

    // 2a. A passwordless row — created by Google, or by an invite — that nobody
    //     ever proved password control of. Nothing is being taken over.
    const linkedNow = await this.users.linkGoogleSub(
      existing.user.id,
      identity.sub,
    );
    // The write is conditional on the row still being unlinked, so null means
    // another login claimed it in the meantime. Refusing is right: whoever won
    // may have been a different identity, and this request cannot tell.
    if (!linkedNow) {
      throw new ConflictException(
        'That email is already linked to a different Google account',
      );
    }
    return this.sessionFor(linkedNow);
  }

  /** The caller's own profile, read fresh rather than taken from the token. */
  async findMe(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid token');
    return toUserContract(user);
  }

  /**
   * The one place a session is minted, so register, login and Google login
   * cannot drift into returning different shapes.
   */
  async sessionFor(user: UserRecord): Promise<AuthSession> {
    if (!this.auth.issueToken) {
      throw new Error('The bound auth adapter cannot issue tokens');
    }
    const accessToken = await this.auth.issueToken(user.id);
    return {
      user: toUserContract(user),
      token: {
        accessToken,
        // `refreshToken` is omitted, not empty: there is no refresh flow, and a
        // blank string would read to a client as one that failed.
        expiresAt: new Date(
          Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
        ).toISOString(),
      },
    };
  }
}

import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleTokenVerifier } from './google-token-verifier';
import type {
  AuthSession,
  LoginRequest,
  UpdateMeRequest,
  User,
} from '@chatofy/types';
import { normalizeEmail } from './normalize-email';
import { PasswordHasher } from './password-hasher';
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

/** One message and one status for every failed login. */
const LOGIN_FAILED = 'Invalid email or password';

/**
 * Signing in, and the profile behind a token.
 *
 * Registration lives in `RegistrationService` and recovery in
 * `PasswordResetService`; both mint no session and neither is reachable from
 * here. What is left is the pair of ways to obtain one — a password, or a Google
 * identity — plus the single place a session is built.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    private readonly google: GoogleTokenVerifier,
    private readonly hasher: PasswordHasher,
  ) {}

  async login(dto: LoginRequest): Promise<AuthSession> {
    const found = await this.users.findCredentialsByEmail(
      normalizeEmail(dto.email),
    );

    // Both misses cost the same and say the same thing: an unknown email is
    // verified against the dummy hash, and a Google-first row with no password
    // takes that path too rather than admitting it exists but has no password.
    const hash = found?.passwordHash ?? (await this.hasher.dummy());
    const matches = await this.hasher.verify(hash, dto.password);

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
      // Same race as registration, reached only on an account's FIRST Google
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
   * Changes what the caller asked to change about their own row — today, one field.
   *
   * Goes through the repository's `updateLocale` rather than a general update, so
   * there is no method here that could be handed a DTO naming a column the caller
   * has no business setting.
   */
  async updateMe(userId: string, dto: UpdateMeRequest): Promise<User> {
    const user = await this.users.updateLocale(userId, dto.locale);
    return toUserContract(user);
  }

  /**
   * The one place a session is minted, so password login and Google login cannot
   * drift into returning different shapes.
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

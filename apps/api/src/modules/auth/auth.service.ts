import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GoogleTokenVerifier } from './google-token-verifier';
import * as argon2 from 'argon2';
import type {
  AuthSession,
  LoginRequest,
  RegisterRequest,
  User,
} from '@chatofy/types';
import { toUserContract } from '../users/mappers/to-user.mapper';
import type {
  UserRecord,
  UserRepository,
} from '../users/interfaces/user-repository.interface';
import { USER_REPOSITORY } from '../users/interfaces/user-repository.interface';
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
const DUMMY_HASH_PROMISE = argon2.hash('a password no account has');

/** One message and one status for every failed login. */
const LOGIN_FAILED = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    private readonly google: GoogleTokenVerifier,
  ) {}

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

  async register(dto: RegisterRequest): Promise<AuthSession> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      // A 409 here is an account-existence oracle for the same fact login
      // refuses to reveal. Closing it needs an email-verification flow, which
      // is out of scope; recorded rather than left to look like an oversight.
      throw new ConflictException('That email is already registered');
    }

    const user = await this.users.create({
      email: dto.email,
      displayName: dto.displayName,
      passwordHash: await this.hashPassword(dto.password),
    });
    return this.sessionFor(user);
  }

  async login(dto: LoginRequest): Promise<AuthSession> {
    const found = await this.users.findCredentialsByEmail(dto.email);

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
   * The second matters more here than it usually would. Registration proves no
   * mailbox control — email verification is an explicit non-goal — so anyone can
   * create an account for victim@company.com with a password of their choosing.
   * If the real owner then signed in with Google and a naive "found by email and
   * verified, so link" rule ran, they would be logged into the ATTACKER's row,
   * whose password was never removed. That attacker keeps read access to the
   * victim's sessions and the full text of their translated meetings, and with
   * revocation a non-goal, noticing does not end it: their token runs its seven
   * days out.
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

    const existing = await this.users.findCredentialsByEmail(identity.email);

    // 3. Nobody by that email: a fresh, passwordless account.
    if (!existing) {
      if (!identity.emailVerified) {
        throw new UnauthorizedException(
          'Google has not verified that email address',
        );
      }
      const created = await this.users.create({
        email: identity.email,
        googleSub: identity.sub,
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
      });
      return this.sessionFor(created);
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

    // 2a. A passwordless row — created by Google, or by an invite — that nobody
    //     ever proved password control of. Nothing is being taken over.
    const linkedNow = await this.users.linkGoogleSub(
      existing.user.id,
      identity.sub,
    );
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

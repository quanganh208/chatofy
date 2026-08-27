import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleTokenVerifier } from './google-token-verifier';
import type { GoogleIdentity } from './google-token-verifier';
import { Env } from '../../config/env.schema';
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
import {
  AVATAR_STORAGE,
  AvatarStorageUnavailableError,
  type AvatarStorage,
} from '../storage/interfaces/avatar-storage.interface';
import {
  MAX_AVATAR_BYTES,
  buildAvatarKey,
  sniffAvatarImage,
} from '../storage/avatar-image';
import type { AvatarImageType } from '../storage/avatar-image';
import { fetchGoogleAvatar } from '../storage/google-avatar-importer';

/** Token lifetime, mirrored from JwtModule so `expiresAt` and `exp` agree. */
export const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** One message and one status for every failed login. */
const LOGIN_FAILED = 'Invalid email or password';

/**
 * What a caller is told when the object store is not set up.
 *
 * Reported as a 409, not a 503. Two independent reasons: `ApiErrorResponses`
 * throws at class-decoration time for any status outside its table — which has
 * no 503 — and `all-exceptions.filter.ts` replaces every 5xx message with
 * 'Internal server error', so a 503 could not say this at all. A 4xx keeps its
 * message, and the message is the whole value.
 */
const AVATAR_STORAGE_UNAVAILABLE =
  'Avatar storage is not configured on this server';

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
    private readonly config: ConfigService<Env, true>,
    @Inject(AVATAR_STORAGE) private readonly avatars: AvatarStorage,
  ) {}

  private readonly logger = new Logger(AuthService.name);

  /**
   * The origin avatars are served from, or undefined when R2 is unconfigured.
   *
   * Read through the config service rather than `process.env` so an environment
   * that never declared it cannot silently produce a URL — `toUserContract`
   * yields null for an unset base, which is the whole reason it takes one.
   */
  private get avatarBaseUrl(): string | undefined {
    return this.config.get('R2_PUBLIC_BASE_URL', { infer: true });
  }

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
    if (linked)
      return this.sessionFor(await this.withGoogleAvatar(linked, identity));

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
        return this.sessionFor(await this.withGoogleAvatar(created, identity));
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
    return this.sessionFor(await this.withGoogleAvatar(linkedNow, identity));
  }

  /** The caller's own profile, read fresh rather than taken from the token. */
  async findMe(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid token');
    return toUserContract(user, this.avatarBaseUrl);
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
    return toUserContract(user, this.avatarBaseUrl);
  }

  /**
   * Replaces the caller's avatar with the given base64 image.
   *
   * Ordering is object-first: the bytes are stored, then the column is pointed at
   * them, then the PREVIOUS object is deleted best-effort. That last step is
   * deliberately allowed to fail — a replaced avatar is one the account holder
   * still wants published, so a leftover object is storage waste rather than a
   * takedown that silently did not happen. Removal, where someone HAS asked for
   * bytes to stop existing, is the strict case; see `removeAvatar`.
   */
  async setAvatar(userId: string, base64: string): Promise<User> {
    // Checked before decoding, so an unconfigured deployment refuses without
    // buffering anything.
    if (!this.avatars.enabled) {
      throw new ConflictException(AVATAR_STORAGE_UNAVAILABLE);
    }

    const bytes = Buffer.from(base64, 'base64');
    // `Buffer.from(x, 'base64')` DISCARDS what it cannot parse rather than
    // throwing, so junk decodes to an empty or truncated buffer. The emptiness
    // check is what turns that into a 400 instead of a confusing sniff failure.
    if (bytes.length === 0) {
      throw new BadRequestException('The image could not be decoded');
    }
    if (bytes.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException(
        `Images must be ${Math.floor(MAX_AVATAR_BYTES / 1024)}KB or smaller`,
      );
    }
    // The bytes decide the type, never a client's claim — these are
    // user-supplied bytes served from an origin the browser treats as ours.
    const type = sniffAvatarImage(bytes);
    if (!type) {
      throw new BadRequestException('That file is not a supported image');
    }

    const updated = await this.storeAvatarBytes(userId, bytes, type);
    return toUserContract(updated, this.avatarBaseUrl);
  }

  /**
   * Removes the caller's avatar. The OBJECT first, the columns only after.
   *
   * Authoritative rather than best-effort, and that inversion is the point: the
   * bucket is public-read, so clearing the column while the object survives
   * leaves the photograph reachable at its URL while the user has been told 200.
   * A retryable 409 with the columns untouched is a better answer than a false
   * confirmation, so a storage failure here fails the request.
   */
  async removeAvatar(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid token');

    // Nothing to remove: the caller asked for a state that already holds, which
    // is a 200 rather than a 404. Nothing is stamped — an unstamped row is what
    // still permits a first Google import.
    if (!user.avatarKey) return toUserContract(user, this.avatarBaseUrl);

    try {
      await this.avatars.delete(user.avatarKey);
    } catch (err) {
      this.logger.warn(
        `Could not delete avatar object for ${userId}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      // The columns are deliberately left as they were, so the user can retry
      // and the object is never orphaned by a clear that outlived its delete.
      throw new ConflictException(
        this.avatars.enabled
          ? 'Could not remove the avatar right now — try again'
          : AVATAR_STORAGE_UNAVAILABLE,
      );
    }

    // Conditional on the key still being the one just deleted. Two tabs — one
    // uploading, one removing — would otherwise let this clear a column already
    // pointing at a NEW object, orphaning bytes the user just chose. A lost race
    // means someone else wrote a newer state, so the fresh row is the answer.
    const cleared = await this.users.updateAvatarKey(
      userId,
      null,
      new Date(),
      user.avatarKey,
    );
    if (!cleared) {
      const current = await this.users.findById(userId);
      if (!current) throw new UnauthorizedException('Invalid token');
      return toUserContract(current, this.avatarBaseUrl);
    }
    return toUserContract(cleared, this.avatarBaseUrl);
  }

  /**
   * Imports the Google profile picture, at most once in a row's life.
   *
   * The gate is `avatarChangedAt`, NOT a null key. A null key means both "never
   * had one" and "the account holder removed one", and importing over a removal
   * would leave a Google user unable to have no picture — they remove it, and
   * the next sign-in puts it back. Every avatar write stamps that column,
   * including this one, so a decision of any kind closes the import for good.
   *
   * Returns the row unchanged on ANY failure and never throws. Nothing here may
   * cost someone their sign-in: a person signing in does not care about their
   * avatar in that moment.
   *
   * Applied by wrapping each of `loginWithGoogle`'s three terminal returns
   * rather than at a single join point, because there is no single join point:
   * the three branches bind three different variables, and `sessionFor` — the
   * one thing they share — is also the password path, where hooking this would
   * put an outbound fetch on every password sign-in.
   */
  private async withGoogleAvatar(
    user: UserRecord,
    identity: GoogleIdentity,
  ): Promise<UserRecord> {
    // `enabled` is checked HERE, not only inside the store, and it is the check
    // that keeps "at most once per row" true rather than "at most one SUCCESS".
    // `avatarChangedAt` is stamped only by a completed write, so on a deployment
    // with no R2 — the normal state in development — an import that always fails
    // leaves the gate open and every Google sign-in would repeat the outbound
    // fetch to Google and the doomed put.
    if (
      user.avatarChangedAt !== undefined ||
      !identity.picture ||
      !this.avatars.enabled
    ) {
      return user;
    }
    try {
      const bytes = await fetchGoogleAvatar(identity.picture, this.logger);
      if (!bytes) return user;
      return await this.storeAvatarBytes(user.id, bytes);
    } catch (err) {
      this.logger.warn(
        `Could not import a Google avatar for ${user.id}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return user;
    }
  }

  /**
   * Stores already-validated bytes and points the row at them.
   *
   * Split out so the Google importer reaches one function rather than repeating
   * the store-then-swap sequence — and so both write paths stamp
   * `avatarChangedAt`, which is what keeps the import to once per row.
   */
  private async storeAvatarBytes(
    userId: string,
    bytes: Buffer,
    sniffed?: AvatarImageType,
  ): Promise<UserRecord> {
    // `setAvatar` has already sniffed to produce its 400 and passes the result
    // down; the importer has not, so it sniffs here. Either way the bytes decide
    // the type exactly once, and the cap inside the sniff still bounds the
    // importer's payload.
    const type = sniffed ?? sniffAvatarImage(bytes);
    if (!type) {
      throw new BadRequestException('That file is not a supported image');
    }

    const previous = (await this.users.findById(userId))?.avatarKey;
    const key = buildAvatarKey(userId, bytes, type);
    try {
      await this.avatars.put(key, bytes, type.mime);
    } catch (err) {
      if (err instanceof AvatarStorageUnavailableError) {
        throw new ConflictException(
          this.avatars.enabled ? err.message : AVATAR_STORAGE_UNAVAILABLE,
        );
      }
      throw err;
    }

    const updated = await this.users.updateAvatarKey(userId, key, new Date());
    if (!updated) throw new UnauthorizedException('Invalid token');

    if (previous && previous !== key) {
      // Best-effort, unlike removal: the user still wants an avatar published,
      // so a leftover object is storage waste rather than a takedown that
      // failed. Failing the whole change over it would be the worse trade.
      try {
        await this.avatars.delete(previous);
      } catch (err) {
        this.logger.warn(
          `Left an orphaned avatar object ${previous}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
    return updated;
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
      user: toUserContract(user, this.avatarBaseUrl),
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

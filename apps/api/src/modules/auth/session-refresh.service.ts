import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthToken } from '@chatofy/types';
import { UsersService } from '../users/users.service';
import {
  AUTH_ADAPTER,
  type AuthAdapter,
} from './interfaces/auth-adapter.interface';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.service';
import { isRevokedByPasswordChange } from './password-change-revocation';
import { RefreshTokenStore } from './refresh/refresh-token.store';
import { SessionTerminator } from './session-terminator';

/** What a caller is told for every terminal verdict, whatever produced it. */
const SESSION_ENDED = 'Invalid token';

/**
 * Renewing a session, and the gate that stops a refresh token resurrecting one
 * a password reset killed.
 *
 * A FOURTH flow service rather than a method on `AuthService`, for the reason
 * the module comment already argues for the other three: renewal shares only
 * the token minting with signing in, and `auth.service.ts` is well past the
 * size where a reader finds anything.
 *
 * THE FAILURE TAXONOMY IS THE CONTRACT, and it is deliberately the same one
 * `JwtAuthAdapter.verifyToken` uses:
 *
 *   a NULL row            → 401. The user is gone.
 *   a THROWN Postgres read → propagates as 5xx. Never 401.
 *   a THROWN Redis call    → 503. Never 401, and never a bare 500.
 *
 * The distinction is not pedantry. Every client in this system reads a 401 from
 * here as proof the session is dead and signs the user out; a thirty-second
 * infrastructure blip answering 401 would sign out every active user across
 * web, extension and mobile at once, and they could not sign back in, because
 * login needs the same infrastructure.
 */
@Injectable()
export class SessionRefreshService {
  private readonly logger = new Logger(SessionRefreshService.name);

  constructor(
    @Inject(AUTH_ADAPTER) private readonly auth: AuthAdapter,
    private readonly users: UsersService,
    private readonly store: RefreshTokenStore,
    private readonly terminator: SessionTerminator,
  ) {}

  /**
   * Trades a refresh token for a fresh pair.
   *
   * Returns only the TOKEN half, never the full session: the client's cached
   * profile is not stale-critical, and a refresh that rewrote `session.user`
   * would fight the web's own avatar-update path.
   */
  async refresh(rawToken: string): Promise<AuthToken> {
    const rotation = await this.rotate(rawToken);

    // A switch rather than a chain of ifs so the compiler proves the terminal
    // verdicts are all handled: what survives it is a successful rotation, and
    // a verdict added to the store later cannot silently fall through to
    // minting an access token.
    switch (rotation.outcome) {
      case 'reuse': {
        // Detected reuse is a LINEAGE verdict, not a clock one — a token
        // presented after a later generation was already used. That is two
        // parties, so the family is revoked (in the script, atomically) and the
        // sockets go too.
        //
        // STATE THE COST, because it is real: `terminate` closes every live
        // connection this user holds on every device, not just the compromised
        // family — there is no family-to-socket mapping to scope it with. So one
        // unauthenticated call carrying any orphaned token can drop that user's
        // meeting everywhere. Accepted deliberately: leaving a thief streaming
        // the victim's audio through a revocation is worse, and reaching an
        // orphaned token already implies profile or physical access.
        const closed = this.terminator.terminate(rotation.userId);
        this.logger.warn(
          `refresh token reuse detected for ${rotation.userId}; family revoked, ${closed} socket(s) closed`,
        );
        throw new UnauthorizedException(SESSION_ENDED);
      }
      case 'orphaned':
        // A successor of a token that was forgiven. Refused, and NOTHING else:
        // no family revocation, no sockets closed, and pointedly not logged as
        // theft — the common cause is an ordinary duplicate refresh arriving
        // late, and the server cannot tell that from a stolen orphan. The user
        // signs in again on this browser; every other device keeps working.
        this.logger.log(
          'refused an orphaned refresh token; the family was left intact',
        );
        throw new UnauthorizedException(SESSION_ENDED);
      case 'notfound':
      case 'expired':
      case 'revoked':
        throw new UnauthorizedException(SESSION_ENDED);
    }

    if (rotation.outcome === 'recovered') {
      // A SUCCESS, logged at info. A response the browser never received,
      // surfacing late — forgiven once, and the family moved on so the
      // successor it never saw is dead. Logging this as theft would train
      // whoever reads these logs to ignore the line that matters.
      this.logger.log(
        `recovered a lost refresh for family ${rotation.familyId}`,
      );
    }

    // The gate. A refresh token is opaque and carries no `iat`, so the check in
    // `JwtAuthAdapter.verifyToken` cannot see it — without this, a family
    // issued before a reset would mint a NEW access token with a fresh `iat`,
    // later than `passwordChangedAt`, and silently resurrect the session the
    // reset existed to kill. Every existing test would still be green.
    //
    // A thrown read propagates: see the class comment.
    const state = await this.users.findAuthStateById(rotation.userId);
    if (
      state === null ||
      isRevokedByPasswordChange(
        rotation.familyIssuedAt,
        state.passwordChangedAt,
      )
    ) {
      // Kill the family rather than only this leaf. Every sibling then fails
      // its own next use, which is revocation without an N-key delete.
      await this.revokeQuietly(rotation.familyId);
      throw new UnauthorizedException(SESSION_ENDED);
    }

    if (!this.auth.issueToken) {
      throw new Error('The bound auth adapter cannot issue tokens');
    }
    return {
      accessToken: await this.auth.issueToken(rotation.userId),
      refreshToken: rotation.refreshToken,
      expiresAt: new Date(
        Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /**
   * Sign-out. Ends this browser's family server-side.
   *
   * Answers the same for an unknown token as for one it just revoked, so it is
   * not an oracle for "is this token live", and a caller leaving cannot be
   * blocked by a failure it could not act on anyway — including a Redis
   * outage, which is swallowed here rather than raised.
   *
   * It deliberately does NOT terminate sockets. Signing out of one browser must
   * not drop the user's meeting on another device; that is the difference
   * between a voluntary sign-out and detected theft.
   */
  async revoke(rawToken: string): Promise<void> {
    try {
      await this.store.revokeByToken(rawToken);
    } catch (err) {
      this.logger.warn(
        `could not revoke a family on sign-out: ${errorText(err)}`,
      );
    }
  }

  /**
   * A Redis fault becomes 503, THROWN rather than propagated.
   *
   * A raw node-redis error is not an `HttpException`, so letting it through
   * would render as 500 via `AllExceptionsFilter`. 503 is what says "try again"
   * rather than "something is broken about your request", and neither is 401 —
   * which is the only status that signs anybody out.
   */
  private async rotate(rawToken: string) {
    try {
      return await this.store.rotate(rawToken);
    } catch (err) {
      this.logger.error(`refresh store unavailable: ${errorText(err)}`);
      throw new ServiceUnavailableException();
    }
  }

  /** The refusal above is already decided; a failed revoke must not change it into a 5xx. */
  private async revokeQuietly(familyId: string): Promise<void> {
    try {
      await this.store.revokeFamily(familyId);
    } catch (err) {
      this.logger.error(
        `could not revoke family ${familyId}: ${errorText(err)}`,
      );
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

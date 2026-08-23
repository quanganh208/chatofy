import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../../users/users.service';
import {
  AuthAdapter,
  AuthClaims,
  UserIdentity,
} from '../interfaces/auth-adapter.interface';

/**
 * The API as its own identity provider: it signs the access tokens it later
 * verifies, so nothing about a request depends on reaching an external service.
 *
 * `issueToken` is the optional member the interface always described as "only
 * for providers that issue tokens themselves (e.g. custom JWT)" — this is that
 * provider.
 *
 * Tokens carry `sub` and nothing else. Every other fact about a user is one
 * lookup away and can change while a token is live; copying it into a
 * seven-day credential would mean serving a stale display name or, worse, a
 * stale email long after the row moved on.
 */
@Injectable()
export class JwtAuthAdapter implements AuthAdapter {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  /**
   * Rejects anything that is not a live, correctly signed token.
   *
   * Expiry, signature and malformed input all arrive here as a throw from
   * `verifyAsync`, and all mean the same thing to a caller — no identity — so
   * they collapse into one UnauthorizedException rather than telling an
   * attacker which of the three they hit.
   */
  async verifyToken(token: string): Promise<AuthClaims> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
        throw new UnauthorizedException('Invalid token');
      }
      return claims as AuthClaims;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Resolve a verified subject to a user, refusing one whose row is gone.
   *
   * NOT a revocation path, whatever it looks like. `JwtAuthGuard` calls
   * `verifyToken` only — it never reads the database — so a deleted user's
   * token keeps opening `POST /translate` and the `/ws/translate` upgrade for
   * the rest of its seven days. Only `GET /auth/me` notices, through
   * `AuthService.findMe`.
   *
   * Kept because `AuthAdapter` is the provider-agnostic seam and a hosted
   * provider would implement it; wiring it into the guard would mean a database
   * read on every request AND every socket upgrade, which is a real cost for a
   * revocation this design has already decided not to offer.
   */
  async getUser(userId: string): Promise<UserIdentity> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid token');
    return {
      id: user.id,
      email: user.email,
      ...(user.displayName === undefined
        ? {}
        : { displayName: user.displayName }),
    };
  }

  /** Signs an access token. Lifetime comes from JwtModule's registration. */
  async issueToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }
}

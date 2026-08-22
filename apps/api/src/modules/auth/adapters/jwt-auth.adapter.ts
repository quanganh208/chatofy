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
   * A token whose subject no longer exists is not a valid identity. Deleting a
   * user is the one revocation this design has, so a missing row must fail the
   * same way a bad signature does rather than returning a hollow identity.
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

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
 * seven-day credential would mean serving a stale name or, worse, a
 * stale email long after the row moved on.
 */
@Injectable()
export class JwtAuthAdapter implements AuthAdapter {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  /**
   * Rejects anything that is not a live, correctly signed, unrevoked token.
   *
   * Expiry, signature and malformed input all arrive as a throw from
   * `verifyAsync`, and all mean the same thing to a caller — no identity — so
   * they collapse into one UnauthorizedException rather than telling an
   * attacker which of the three they hit.
   *
   * THIS IS A REVOCATION PATH. It costs one indexed primary-key read per
   * authenticated request and per socket upgrade, and it buys two things: a
   * deleted user's token stops working, and a token issued before a password
   * change stops working. `JwtAuthGuard` and the gateway's `verifyClient` both
   * route through here, so neither needs its own check and neither can drift.
   */
  async verifyToken(token: string): Promise<AuthClaims> {
    let claims: AuthClaims;
    try {
      const decoded = await this.jwt.verifyAsync<{ sub?: unknown }>(token);
      if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
        throw new UnauthorizedException('Invalid token');
      }
      claims = decoded as AuthClaims;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // The database read sits OUTSIDE that catch, deliberately.
    //
    // Collapsing everything into 401 is right for the three CRYPTOGRAPHIC
    // failures above and wrong for an infrastructure one. A restarted or briefly
    // unreachable Postgres would otherwise answer every request and every
    // upgrade with 401 — and `use-auth-recovery.ts` on the web reads a 401 from
    // GET /auth/me as proof the session is gone and calls `signOut()`. A
    // thirty-second blip would forcibly sign out every active user across web,
    // extension and mobile, and they could not sign back in, because login needs
    // the same database. A thrown read must stay a 5xx.
    //
    // So the two failure modes are told apart explicitly: a NULL row is a user
    // who is gone (401); a THROWN read is a fault (propagated).
    const state = await this.users.findAuthStateById(claims.sub);
    if (!state) throw new UnauthorizedException('Invalid token');

    if (state.passwordChangedAt !== null) {
      // `AuthClaims` indexes to `unknown`, and `Math.floor(undefined) < x` is
      // `false` — which would PASS the comparison below. A token that cannot
      // say when it was issued cannot be shown to predate the change, so it is
      // refused rather than given the benefit of the doubt.
      const issuedAt = claims.iat;
      if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) {
        throw new UnauthorizedException('Invalid token');
      }
      // Strict `<` against a timestamp the writer CEILED to the next whole
      // second (see `AuthService`). Both halves matter: `iat` has one-second
      // resolution, so truncating the stored value down instead would leave
      // every token minted during the reset's own second valid for its full
      // seven days — and the person a reset locks out is exactly the one who
      // knows the password and can poll login to land inside that second.
      const changedAt = Math.floor(state.passwordChangedAt.getTime() / 1000);
      if (Math.floor(issuedAt) < changedAt) {
        throw new UnauthorizedException('Invalid token');
      }
    }

    return claims;
  }

  /**
   * Resolve a verified subject to a full identity.
   *
   * Distinct from the revocation read in `verifyToken`, which every caller
   * already pays: that one answers "is this token still good" from two columns,
   * this one answers "who is this" and returns a profile. Kept because
   * `AuthAdapter` is the provider-agnostic seam and a hosted provider would
   * implement it.
   */
  async getUser(userId: string): Promise<UserIdentity> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid token');
    return {
      id: user.id,
      email: user.email,
      ...(user.name === undefined ? {} : { name: user.name }),
    };
  }

  /** Signs an access token. Lifetime comes from JwtModule's registration. */
  async issueToken(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId });
  }
}

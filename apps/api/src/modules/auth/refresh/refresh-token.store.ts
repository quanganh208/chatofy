import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  REDIS_CLIENT,
  type RedisClient,
} from '../../redis/redis-client.provider';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  ROTATION_GRACE_SECONDS,
  familyKey,
  hashRefreshToken,
  mintRefreshToken,
  tokenKey,
} from './refresh-token-secret';
import {
  REVOKE_BY_TOKEN_LUA,
  REVOKE_FAMILY_LUA,
  ROTATE_REFRESH_TOKEN_LUA,
} from './rotate-refresh-token.lua';

/** A freshly minted leaf and the family it belongs to. */
export interface IssuedRefreshToken {
  /** The raw token — the ONLY moment it exists outside the caller's response. */
  refreshToken: string;
  familyId: string;
  /**
   * When the family was minted, epoch seconds, FLOORED.
   *
   * Floored on purpose and not incidentally: it is compared against
   * `passwordChangedAt`, which its writer CEILS, and the pair
   * `floor(issuedAt) < ceil(changedAt)` is what refuses a family minted inside
   * a reset's own second. See `password-change-revocation.ts`.
   */
  issuedAt: number;
}

/**
 * Every verdict the rotation script can reach.
 *
 * A discriminated union rather than a nullable result: `notfound`, `expired`
 * and `revoked` are all "sign in again" but `reuse` additionally means a family
 * was just revoked and a thief may hold a live socket, and the caller has to be
 * able to tell those apart. Collapsing them would make that call unreachable.
 */
export type RotationResult =
  | {
      /** `grace` and `recovered` are SUCCESSES — see the Lua header. */
      outcome: 'rotated' | 'grace' | 'recovered';
      refreshToken: string;
      userId: string;
      familyId: string;
      /** Epoch seconds, floored — see {@link IssuedRefreshToken.issuedAt}. */
      familyIssuedAt: number;
    }
  | { outcome: 'reuse'; userId: string }
  /**
   * Terminal for the presented token, and ONLY for it.
   *
   * `orphaned` is deliberately separate from `reuse`: it carries no subject
   * because there is nothing to act on beyond refusing the call — the family
   * survives and no sockets close. See the script header for why the two
   * lineage failures answer differently.
   */
  | { outcome: 'notfound' | 'expired' | 'revoked' | 'orphaned' };

/**
 * The ONLY class that talks to Redis about refresh tokens.
 *
 * Nothing above it constructs a key, and nothing below it knows what a session
 * is. Two consequences worth keeping: the plaintext token exists here and in
 * the HTTP response and nowhere else — Redis holds SHA-256 only, on every path
 * including the grace window — and a Redis fault leaves this class as a thrown
 * error rather than a verdict, so the caller can answer 503 instead of 401.
 */
@Injectable()
export class RefreshTokenStore {
  private readonly logger = new Logger(RefreshTokenStore.name);

  /**
   * Cached SHA of each loaded script, so the common path sends 40 bytes rather
   * than the whole source. Reset implicitly by the NOSCRIPT fallback below,
   * which is how a Redis restart or a SCRIPT FLUSH heals itself.
   */
  private readonly shas = new Map<string, string>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  /**
   * Mints a brand-new family with one leaf. Called by login, not by refresh.
   *
   * `gen` starts at 1 against `lastUsedGen` 0, so the first token is not
   * already behind its own family.
   */
  async issueFamily(userId: string): Promise<IssuedRefreshToken> {
    const familyId = randomUUID();
    const refreshToken = mintRefreshToken();
    const leafKey = tokenKey(hashRefreshToken(refreshToken));
    const issuedAt = Math.floor(Date.now() / 1000);
    const famExpiresAt = issuedAt + REFRESH_TOKEN_TTL_SECONDS;

    await this.redis
      .multi()
      .hSet(familyKey(familyId), {
        userId,
        issuedAt: String(issuedAt),
        revoked: '0',
        famExpiresAt: String(famExpiresAt),
        lastUsedGen: '0',
        epoch: '0',
      })
      .expire(familyKey(familyId), REFRESH_TOKEN_TTL_SECONDS)
      .hSet(leafKey, {
        familyId,
        status: 'active',
        gen: '1',
        epoch: '0',
        spentAt: '',
        replacedBy: '',
      })
      .expire(leafKey, REFRESH_TOKEN_TTL_SECONDS)
      .exec();

    return { refreshToken, familyId, issuedAt };
  }

  /**
   * Trades a presented token for its successor, atomically.
   *
   * Throws on a Redis fault rather than returning a verdict — the distinction
   * the whole design rests on. A thrown error becomes 503; only a returned
   * terminal verdict becomes 401, because clients read a 401 as proof the
   * session is dead and a blip must not sign anyone out.
   */
  async rotate(rawToken: string): Promise<RotationResult> {
    const newToken = mintRefreshToken();
    const reply = (await this.evalCached(
      ROTATE_REFRESH_TOKEN_LUA,
      [tokenKey(hashRefreshToken(rawToken))],
      [
        hashRefreshToken(newToken),
        String(Math.floor(Date.now() / 1000)),
        String(REFRESH_TOKEN_TTL_SECONDS),
        String(ROTATION_GRACE_SECONDS),
      ],
    )) as unknown[];

    const outcome = String(reply[0]);
    switch (outcome) {
      case 'rotated':
      case 'grace':
      case 'recovered':
        return {
          outcome,
          refreshToken: newToken,
          userId: String(reply[1]),
          familyId: String(reply[2]),
          familyIssuedAt: Number(reply[3]),
        };
      case 'reuse':
        return { outcome, userId: String(reply[1]) };
      case 'expired':
      case 'revoked':
      case 'orphaned':
        return { outcome };
      default:
        // `notfound`, and anything a future script edit could add. Terminal
        // either way; an unrecognised verdict must not read as success.
        return { outcome: 'notfound' };
    }
  }

  /**
   * Revokes a whole family by id. Used where the caller already knows it: a
   * detected replay, and the password-change gate refusing a stale family.
   *
   * Sibling leaves are NOT deleted. They fail the `revoked` check on their next
   * use and expire on their own, which keeps this a single-key write instead of
   * an unbounded scan.
   */
  async revokeFamily(familyId: string): Promise<boolean> {
    const reply = await this.evalCached(
      REVOKE_FAMILY_LUA,
      [familyKey(familyId)],
      [],
    );
    return reply === 1;
  }

  /** Sign-out: revoke whatever family this token belongs to, if any. */
  async revokeByToken(rawToken: string): Promise<boolean> {
    const reply = await this.evalCached(
      REVOKE_BY_TOKEN_LUA,
      [tokenKey(hashRefreshToken(rawToken))],
      [],
    );
    return reply === 1;
  }

  /**
   * `EVALSHA` with an `EVAL` fallback.
   *
   * The fallback is not an optimisation detail — it is how a Redis restart, a
   * failover, or an operator's `SCRIPT FLUSH` heals instead of turning every
   * refresh into an error. Only NOSCRIPT is retried; any other Redis error is a
   * real fault and must propagate so the caller can answer 503.
   */
  private async evalCached(
    script: string,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    const sha = this.shas.get(script);
    if (sha !== undefined) {
      try {
        return await this.redis.evalSha(sha, { keys, arguments: args });
      } catch (err) {
        if (!isNoScriptError(err)) throw err;
        this.shas.delete(script);
        this.logger.log('Redis lost the cached script; reloading it');
      }
    }
    const loaded = await this.redis.scriptLoad(script);
    this.shas.set(script, loaded);
    return this.redis.evalSha(loaded, { keys, arguments: args });
  }
}

function isNoScriptError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('NOSCRIPT');
}

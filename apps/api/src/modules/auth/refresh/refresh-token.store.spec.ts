import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RedisClient } from '../../redis/redis-client.provider';
import { RefreshTokenStore } from './refresh-token.store';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  ROTATION_GRACE_SECONDS,
  hashRefreshToken,
} from './refresh-token-secret';

/**
 * A stub Redis, not a real one: this file is about key shapes, hashing and the
 * mapping from a Lua verdict to a `RotationResult`. What the SCRIPT actually
 * does with those keys is a claim about real Lua, real TTLs and real
 * atomicity, so it is asserted in `test/refresh-token-rotation.db-e2e-spec.ts`
 * against a live Redis. Asserting script behaviour against a mock would prove
 * only that the mock agrees with itself.
 */
/** What the store passes as `evalSha`'s second argument. */
interface EvalOptions {
  keys: string[];
  arguments: string[];
}

/** A script reply, typed once so a test can swap in any verdict shape. */
const replying = (reply: unknown) =>
  vi.fn(async (_sha: string, _options: EvalOptions): Promise<unknown> => reply);

/** The options of the first `evalSha` call, or a failure that says so. */
function evalOptions(calls: [string, EvalOptions][]): EvalOptions {
  const first = calls[0];
  if (first === undefined) throw new Error('the script was never evaluated');
  return first[1];
}

function stubRedis() {
  const multi = {
    hSet: vi.fn((_key: string, _fields: Record<string, string>) => multi),
    expire: vi.fn((_key: string, _seconds: number) => multi),
    exec: vi.fn(async (): Promise<unknown[]> => []),
  };
  const client = {
    multi: vi.fn(() => multi),
    scriptLoad: vi.fn(async (_script: string) => 'sha-1'),
    evalSha: replying(['notfound']),
  };
  return { client, multi };
}

describe('RefreshTokenStore', () => {
  let redis: ReturnType<typeof stubRedis>;
  let store: RefreshTokenStore;

  beforeEach(() => {
    redis = stubRedis();
    store = new RefreshTokenStore(redis.client as unknown as RedisClient);
  });

  describe('issueFamily', () => {
    it('writes the family and its first leaf under hashed keys', async () => {
      const issued = await store.issueFamily('user_1');

      const [famArgs, leafArgs] = redis.multi.hSet.mock.calls;
      expect(famArgs?.[0]).toBe(`rtfam:${issued.familyId}`);
      expect(famArgs?.[1]).toMatchObject({
        userId: 'user_1',
        revoked: '0',
        // gen starts at 1 against lastUsedGen 0, so the first token is not
        // already behind its own family.
        lastUsedGen: '0',
        epoch: '0',
      });
      expect(leafArgs?.[0]).toBe(`rt:${hashRefreshToken(issued.refreshToken)}`);
      expect(leafArgs?.[1]).toMatchObject({
        status: 'active',
        gen: '1',
        epoch: '0',
      });
    });

    it('stores no plaintext token anywhere', async () => {
      const issued = await store.issueFamily('user_1');

      const written = JSON.stringify(redis.multi.hSet.mock.calls);
      expect(written).not.toContain(issued.refreshToken);
      // The hash IS there — that is the point of the key.
      expect(written).toContain(hashRefreshToken(issued.refreshToken));
    });

    it('floors issuedAt to whole seconds', async () => {
      // Not cosmetic. It is compared against `passwordChangedAt`, whose writer
      // CEILS, and `floor(issuedAt) < ceil(changedAt)` is the pair that refuses
      // a family minted inside a reset's own second.
      const issued = await store.issueFamily('user_1');
      expect(Number.isInteger(issued.issuedAt)).toBe(true);
    });

    it('expires both keys at the family lifetime', async () => {
      await store.issueFamily('user_1');
      for (const call of redis.multi.expire.mock.calls) {
        expect(call[1]).toBe(REFRESH_TOKEN_TTL_SECONDS);
      }
    });
  });

  describe('rotate', () => {
    it('keys on the hash and passes the clock and grace window in', async () => {
      redis.client.evalSha = replying([
        'rotated',
        'user_1',
        'fam_1',
        '1700000000',
        '2592000',
      ]);

      const result = await store.rotate('presented-token');

      const call = evalOptions(redis.client.evalSha.mock.calls);
      expect(call.keys).toEqual([`rt:${hashRefreshToken('presented-token')}`]);
      expect(call.arguments[3]).toBe(String(ROTATION_GRACE_SECONDS));
      // The successor's HASH is what the script is given; the raw value comes
      // back to the caller and never reaches Redis.
      expect(result.outcome).toBe('rotated');
      if (result.outcome !== 'rotated') throw new Error('unreachable');
      expect(call.arguments[0]).toBe(hashRefreshToken(result.refreshToken));
      expect(call.arguments[0]).not.toBe(result.refreshToken);
    });

    it.each(['rotated', 'grace', 'recovered'] as const)(
      'maps %s to a successful rotation carrying a new token',
      async (outcome) => {
        redis.client.evalSha = replying([
          outcome,
          'user_1',
          'fam_1',
          '1700000000',
          '2592000',
        ]);

        const result = await store.rotate('t');

        // `grace` and `recovered` are SUCCESSES. A caller that treated either as
        // a failure would 401 a legitimate racing tab, or report an ordinary
        // lost response as theft.
        if (!('refreshToken' in result)) {
          throw new Error(
            `expected a successful rotation, got ${result.outcome}`,
          );
        }
        expect(result.outcome).toBe(outcome);
        expect(result.userId).toBe('user_1');
        expect(result.familyId).toBe('fam_1');
        expect(result.familyIssuedAt).toBe(1700000000);
        // A token the caller can actually present next time.
        expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      },
    );

    it('carries NO subject on orphaned, because nothing is acted on', async () => {
      // The distinction from `reuse`: an orphan is refused and the family lives,
      // so there is no user whose sockets need closing.
      redis.client.evalSha = replying(['orphaned']);
      await expect(store.rotate('t')).resolves.toEqual({ outcome: 'orphaned' });
    });

    it('carries the subject on reuse, so sockets can be closed', async () => {
      redis.client.evalSha = replying(['reuse', 'user_1']);

      await expect(store.rotate('t')).resolves.toEqual({
        outcome: 'reuse',
        userId: 'user_1',
      });
    });

    it.each(['expired', 'revoked', 'notfound', 'orphaned'] as const)(
      'maps %s to a terminal verdict with no token',
      async (outcome) => {
        redis.client.evalSha = replying([outcome]);
        await expect(store.rotate('t')).resolves.toEqual({ outcome });
      },
    );

    it('treats an unrecognised verdict as terminal, never as success', async () => {
      // A future script edit adding a verdict this switch does not know must
      // fail closed. Reading it as success would mint an access token off a
      // rotation that did not happen.
      redis.client.evalSha = replying(['something-new']);
      await expect(store.rotate('t')).resolves.toEqual({ outcome: 'notfound' });
    });

    it('propagates a Redis fault instead of returning a verdict', async () => {
      // The distinction the whole design rests on: a thrown error becomes 503.
      // Returning a terminal verdict here would become 401, and every client
      // reads a 401 as proof the session is dead — a blip would sign out
      // everybody.
      redis.client.evalSha = vi.fn(
        async (_sha: string, _options: EvalOptions): Promise<unknown> => {
          throw new Error('The client is closed');
        },
      );
      await expect(store.rotate('t')).rejects.toThrow('The client is closed');
    });

    it('reloads the script when Redis has forgotten it', async () => {
      // How a Redis restart or an operator SCRIPT FLUSH heals itself instead of
      // turning every refresh into an error.
      await store.rotate('first');
      redis.client.evalSha = replying([])
        .mockRejectedValueOnce(new Error('NOSCRIPT No matching script'))
        .mockResolvedValueOnce(['notfound']);
      redis.client.scriptLoad = vi.fn(async (_script: string) => 'sha-2');

      await expect(store.rotate('second')).resolves.toEqual({
        outcome: 'notfound',
      });
      expect(redis.client.scriptLoad).toHaveBeenCalledTimes(1);
    });
  });

  describe('revocation', () => {
    it('revokes a family by id', async () => {
      redis.client.evalSha = replying(1);
      await expect(store.revokeFamily('fam_1')).resolves.toBe(true);
      expect(evalOptions(redis.client.evalSha.mock.calls).keys).toEqual([
        'rtfam:fam_1',
      ]);
    });

    it('reports false when there was no family to revoke', async () => {
      redis.client.evalSha = replying(0);
      await expect(store.revokeFamily('gone')).resolves.toBe(false);
    });

    it('resolves a token to its family on sign-out', async () => {
      redis.client.evalSha = replying(1);
      await expect(store.revokeByToken('a-token')).resolves.toBe(true);
      expect(evalOptions(redis.client.evalSha.mock.calls).keys).toEqual([
        `rt:${hashRefreshToken('a-token')}`,
      ]);
    });
  });
});

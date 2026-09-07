import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthAdapter } from './jwt-auth.adapter';
import type { UsersService } from '../../users/users.service';
import type { UserRecord } from '../../users/interfaces/user-repository.interface';

const SECRET = 'a-test-secret-long-enough-for-the-schema';

function record(over: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    email: 'a@b.com',
    name: 'A',
    locale: 'en',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('JwtAuthAdapter', () => {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: 60 },
  });
  let users: { findById: Mock; findAuthStateById: Mock };
  let adapter: JwtAuthAdapter;

  beforeEach(() => {
    users = {
      findById: vi.fn(),
      // `verifyToken` now reads this on every call. Defaulted to a live row with
      // no password change, so the tests that are about SIGNATURES stay about
      // signatures.
      findAuthStateById: vi
        .fn()
        .mockResolvedValue({ id: 'user_1', passwordChangedAt: null }),
    };
    adapter = new JwtAuthAdapter(jwt, users as unknown as UsersService);
  });

  it('issues a token that verifies back to the same subject', async () => {
    const token = await adapter.issueToken('user_1');
    await expect(adapter.verifyToken(token)).resolves.toMatchObject({
      sub: 'user_1',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new JwtService({ secret: 'a-completely-different-secret-x' });
    const token = await other.signAsync({ sub: 'user_1' });
    await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'user_1' }, { expiresIn: '-1s' });
    await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a garbage token without throwing anything else', async () => {
    await expect(adapter.verifyToken('not-a-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a well-signed token carrying no subject', async () => {
    const token = await jwt.signAsync({ role: 'admin' });
    await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  /**
   * The revocation check. These prove the CHECK against a directly supplied
   * timestamp; that a completed reset actually WRITES one is proven end to end
   * in the reset flow's own tests. The two must not assert the same fact, or one
   * gets dropped as redundant and the untested half is the one that matters.
   */
  describe('revocation', () => {
    it('refuses a token issued before the password changed', async () => {
      const token = await adapter.issueToken('user_1');
      const { iat } = jwt.decode<{ iat: number }>(token);
      users.findAuthStateById.mockResolvedValue({
        id: 'user_1',
        passwordChangedAt: new Date((iat + 1) * 1000),
      });
      await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses a token minted in the same second as the change', async () => {
      // The write is CEILED to the next whole second, so a token whose `iat`
      // lands inside the reset's own second is strictly older and refused.
      // Truncating down instead would leave that token valid for its full seven
      // days — and the person a reset locks out is exactly the one who knows the
      // password and can poll login to land inside that second.
      const token = await adapter.issueToken('user_1');
      const { iat } = jwt.decode<{ iat: number }>(token);
      const changedAtMs = Math.ceil((iat * 1000 + 1) / 1000) * 1000;
      users.findAuthStateById.mockResolvedValue({
        id: 'user_1',
        passwordChangedAt: new Date(changedAtMs),
      });
      await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('accepts a token issued after the password changed', async () => {
      const token = await adapter.issueToken('user_1');
      const { iat } = jwt.decode<{ iat: number }>(token);
      users.findAuthStateById.mockResolvedValue({
        id: 'user_1',
        passwordChangedAt: new Date((iat - 5) * 1000),
      });
      await expect(adapter.verifyToken(token)).resolves.toMatchObject({
        sub: 'user_1',
      });
    });

    it('refuses a token with no iat once a change is recorded', async () => {
      // `AuthClaims` indexes to `unknown`, and `Math.floor(undefined) < x` is
      // `false` — so an unguarded comparison would PASS this token. Fail closed.
      const token = jwt.sign({ sub: 'user_1' }, { noTimestamp: true });
      users.findAuthStateById.mockResolvedValue({
        id: 'user_1',
        passwordChangedAt: new Date(),
      });
      await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("refuses a deleted user's token", async () => {
      const token = await adapter.issueToken('user_1');
      users.findAuthStateById.mockResolvedValue(null);
      await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('lets a failed read escape as a fault rather than a 401', async () => {
      // The read sits outside the crypto catch on purpose. Collapsed into 401, a
      // restarted database would answer every request and upgrade with 401 —
      // and the web session hook reads a 401 from GET /auth/me as proof the
      // session is gone, so a thirty-second blip would forcibly sign out every
      // active user, who then could not sign back in because login needs the
      // same database.
      const token = await adapter.issueToken('user_1');
      const fault = new Error('connection terminated unexpectedly');
      users.findAuthStateById.mockRejectedValue(fault);
      await expect(adapter.verifyToken(token)).rejects.toBe(fault);
      await expect(adapter.verifyToken(token)).rejects.not.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  it('resolves a user identity for a known subject', async () => {
    users.findById.mockResolvedValue(record());
    await expect(adapter.getUser('user_1')).resolves.toEqual({
      id: 'user_1',
      email: 'a@b.com',
      name: 'A',
    });
  });

  it('refuses a subject whose row no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    await expect(adapter.getUser('gone')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('omits name rather than sending undefined for a user without one', async () => {
    users.findById.mockResolvedValue(record({ name: undefined }));
    await expect(adapter.getUser('user_1')).resolves.toEqual({
      id: 'user_1',
      email: 'a@b.com',
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import { JwtAuthAdapter } from './adapters/jwt-auth.adapter';
import { isRevokedByPasswordChange } from './password-change-revocation';
import { PasswordChangeService } from './password-change.service';
import { SessionTerminator } from './session-terminator';
import type { PasswordHasher } from './password-hasher';
import type { RefreshTokenStore } from './refresh/refresh-token.store';
import type { UsersService } from '../users/users.service';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import {
  FakeAvatarStorage,
  FakeRefreshTokenStore,
  mockUsers,
  realHasher,
  record,
  SECRET,
  stubConfig,
} from './auth-flow.harness';

/**
 * Built over the REAL adapter and the real gate rather than a mocked
 * `issueToken`: the property under test is that the replacement token survives
 * the revocation this same call performs, and only signing and verifying it for
 * real can show that.
 */
describe('PasswordChangeService', () => {
  const CURRENT = 'the-current-password';
  const NEXT = 'a-brand-new-password';

  let users: Mocked<UserRepository>;
  let hasher: PasswordHasher;
  let terminator: SessionTerminator;
  let refreshTokens: FakeRefreshTokenStore;
  let adapter: JwtAuthAdapter;
  let service: PasswordChangeService;
  /** What the adapter's revocation read sees: the stamp the change wrote. */
  let passwordChangedAt: Date | null;
  let currentHash: string;

  beforeEach(async () => {
    users = mockUsers();
    hasher = realHasher();
    terminator = new SessionTerminator();
    refreshTokens = new FakeRefreshTokenStore();
    passwordChangedAt = null;
    currentHash = await argon2.hash(CURRENT);

    users.findCredentialsById.mockImplementation(async () => ({
      user: record(),
      passwordHash: currentHash,
      googleSub: null,
    }));
    // Strictly after the previous stamp, as the real repository writes it.
    users.updatePasswordHash.mockImplementation(async (_id, _hash, at) => {
      const floor = passwordChangedAt ? passwordChangedAt.getTime() + 1000 : 0;
      passwordChangedAt = new Date(Math.max(at.getTime(), floor));
      return { user: record(), changedAt: passwordChangedAt };
    });

    adapter = new JwtAuthAdapter(
      new JwtService({
        secret: SECRET,
        signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
      }),
      {
        findAuthStateById: async () => ({ id: 'user_1', passwordChangedAt }),
      } as unknown as UsersService,
    );
    const auth = new AuthService(
      users,
      adapter,
      { verify: vi.fn() } as never,
      hasher,
      stubConfig(),
      new FakeAvatarStorage(),
      refreshTokens as unknown as RefreshTokenStore,
    );
    service = new PasswordChangeService(users, hasher, terminator, auth);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the new hash with a ceiled stamp', async () => {
    await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });

    const [id, hash, changedAt] = users.updatePasswordHash.mock.calls[0]!;
    expect(id).toBe('user_1');
    await expect(argon2.verify(hash, NEXT)).resolves.toBe(true);
    expect(changedAt.getTime() % 1000).toBe(0);
  });

  it('returns a session the gate accepts, even inside the stamp’s own second', async () => {
    /**
     * The defect this guards against is invisible on a clock that happens to sit
     * on a whole second. 200 ms past one, the stamp ceils to the NEXT second and a
     * token minted with `iat = now` lands one second before it — refused by the
     * very change that minted it. Real wall-clock values, so JWT signing and
     * verification behave normally.
     */
    const base = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(base + 200);

    const session = await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });

    await expect(
      adapter.verifyToken(session.token.accessToken),
    ).resolves.toMatchObject({ sub: 'user_1' });

    const family = refreshTokens.issued[0]!;
    expect(family.token).toBe(session.token.refreshToken);
    expect(family.issuedAt).toBe(passwordChangedAt!.getTime() / 1000);
    expect(isRevokedByPasswordChange(family.issuedAt, passwordChangedAt)).toBe(
      false,
    );
  });

  it('keeps exp and expiresAt measured from the same instant', async () => {
    const session = await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });

    const claims = new JwtService({}).decode<{ iat: number; exp: number }>(
      session.token.accessToken,
    );
    expect(claims.iat).toBe(passwordChangedAt!.getTime() / 1000);
    expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(new Date(session.token.expiresAt).getTime()).toBe(claims.exp * 1000);
  });

  it('revokes a token issued before the change', async () => {
    const before = await adapter.issueToken('user_1');
    await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });

    await expect(adapter.verifyToken(before)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('closes the sockets that user holds open', async () => {
    const closeSessionsFor = vi
      .fn<(userId: string) => number>()
      .mockReturnValue(1);
    terminator.register({ closeSessionsFor });

    await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(closeSessionsFor).toHaveBeenCalledWith('user_1');
  });

  it('stamps AFTER hashing, not before', async () => {
    // Same reasoning and same controlled clock as the reset's version: a stamp
    // taken before the ~100 ms hash leaves tokens minted in between alive.
    const base = Math.ceil(Date.now() / 1000) * 1000;
    let now = base;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(hasher, 'hash').mockImplementation(async () => {
      now = base + 900;
      return '$argon2-the-new-hash';
    });

    await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(users.updatePasswordHash.mock.calls[0]![2].getTime()).toBe(
      base + 1000,
    );
  });

  it('writes only over the hash it verified against', async () => {
    await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(users.updatePasswordHash.mock.calls[0]![3]).toBe(currentHash);
  });

  it('answers 403 when a reset replaced the hash during the change', async () => {
    // The conditional write lost: the password the caller typed is no longer
    // the current one, so nothing is minted and nobody is signed out.
    users.updatePasswordHash.mockResolvedValue(null);
    const closeSessionsFor = vi.fn<(userId: string) => number>();
    terminator.register({ closeSessionsFor });

    await expect(
      service.changePassword('user_1', {
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(closeSessionsFor).not.toHaveBeenCalled();
    expect(refreshTokens.issued).toHaveLength(0);
  });

  it('mints at the stamp actually written, and a later change in the same second ends it', async () => {
    // Two changes ceiled into one second. The repository moves the second stamp
    // a second further, so the first change's session — minted at its own stamp
    // — is strictly older than the second and is refused. Without that, a reset
    // in the same second as an attacker's change would leave their session alive.
    const base = Math.floor(Date.now() / 1000) * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(base + 200);

    const first = await service.changePassword('user_1', {
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    currentHash = await argon2.hash(NEXT);
    const second = await service.changePassword('user_1', {
      currentPassword: NEXT,
      newPassword: 'a-third-password',
    });

    expect(passwordChangedAt!.getTime()).toBe(base + 2000);
    await expect(
      adapter.verifyToken(first.token.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      adapter.verifyToken(second.token.accessToken),
    ).resolves.toMatchObject({ sub: 'user_1' });
  });

  it('answers a wrong current password with 403, never 401, and changes nothing', async () => {
    const closeSessionsFor = vi.fn<(userId: string) => number>();
    terminator.register({ closeSessionsFor });

    const attempt = service.changePassword('user_1', {
      currentPassword: 'not-the-password',
      newPassword: NEXT,
    });

    // A 401 would read to every client as a dead session and sign out the person
    // correcting a typo.
    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    expect(users.updatePasswordHash.mock.calls).toHaveLength(0);
    expect(closeSessionsFor).not.toHaveBeenCalled();
    expect(refreshTokens.issued).toHaveLength(0);
  });

  it('refuses an account with no password with 409 and changes nothing', async () => {
    users.findCredentialsById.mockResolvedValue({
      user: record(),
      passwordHash: null,
      googleSub: 'google-sub',
    });

    await expect(
      service.changePassword('user_1', {
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users.updatePasswordHash.mock.calls).toHaveLength(0);
  });

  it('treats a row deleted since the token verified as no identity', async () => {
    users.findCredentialsById.mockResolvedValue(null);
    await expect(
      service.changePassword('user_1', {
        currentPassword: CURRENT,
        newPassword: NEXT,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

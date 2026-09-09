import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Mocked } from 'vitest';
import type { UsersService } from '../users/users.service';
import type { AuthAdapter } from './interfaces/auth-adapter.interface';
import type {
  RefreshTokenStore,
  RotationResult,
} from './refresh/refresh-token.store';
import type { SessionTerminator } from './session-terminator';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.service';
import { SessionRefreshService } from './session-refresh.service';

const FAMILY_ISSUED_AT = 1_700_000_000;

/** The adapter's own signature, so the mock cannot drift from what it stands in for. */
type IssueToken = NonNullable<AuthAdapter['issueToken']>;

const rotated = (over: Partial<RotationResult> = {}): RotationResult => ({
  outcome: 'rotated',
  refreshToken: 'successor-token',
  userId: 'user_1',
  familyId: 'fam_1',
  familyIssuedAt: FAMILY_ISSUED_AT,
  ...over,
});

describe('SessionRefreshService', () => {
  let auth: Mocked<AuthAdapter>;
  /** Held separately so assertions never read the method off the mock object. */
  let issueToken: ReturnType<typeof vi.fn<IssueToken>>;
  let users: Mocked<Pick<UsersService, 'findAuthStateById'>>;
  let store: Mocked<
    Pick<RefreshTokenStore, 'rotate' | 'revokeFamily' | 'revokeByToken'>
  >;
  let terminator: Mocked<Pick<SessionTerminator, 'terminate'>>;
  let service: SessionRefreshService;

  beforeEach(() => {
    issueToken = vi.fn<IssueToken>().mockResolvedValue('fresh.access.token');
    auth = {
      verifyToken: vi.fn(),
      getUser: vi.fn(),
      issueToken,
    };
    users = {
      findAuthStateById: vi
        .fn()
        .mockResolvedValue({ id: 'user_1', passwordChangedAt: null }),
    };
    store = {
      rotate: vi.fn().mockResolvedValue(rotated()),
      revokeFamily: vi.fn().mockResolvedValue(true),
      revokeByToken: vi.fn().mockResolvedValue(true),
    };
    terminator = { terminate: vi.fn().mockReturnValue(2) };

    service = new SessionRefreshService(
      auth,
      users as unknown as UsersService,
      store as unknown as RefreshTokenStore,
      terminator as unknown as SessionTerminator,
    );
  });

  describe('a successful rotation', () => {
    it('returns the new pair, dated by the access-token lifetime', async () => {
      const before = Date.now();
      const token = await service.refresh('presented');

      expect(token.accessToken).toBe('fresh.access.token');
      expect(token.refreshToken).toBe('successor-token');
      const expiresAt = new Date(token.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(
        before + ACCESS_TOKEN_TTL_SECONDS * 1000,
      );
      expect(expiresAt).toBeLessThanOrEqual(
        Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      );
    });

    it('returns no profile, so a renewal cannot overwrite an edited one', async () => {
      const token = await service.refresh('presented');
      expect(token).not.toHaveProperty('user');
    });

    it.each(['grace', 'recovered'] as const)(
      'treats %s as a success and closes nobody',
      async (outcome) => {
        // `grace` is a racing tab, `recovered` is a response the browser never
        // received. Reading either as theft is the mass logout this design
        // exists to prevent.
        store.rotate.mockResolvedValue(rotated({ outcome }));

        await expect(service.refresh('presented')).resolves.toMatchObject({
          accessToken: 'fresh.access.token',
        });
        expect(terminator.terminate).not.toHaveBeenCalled();
        expect(store.revokeFamily).not.toHaveBeenCalled();
      },
    );
  });

  describe('the password-change gate', () => {
    // NON-NEGOTIABLE. A refresh token is opaque and carries no `iat`, so
    // `JwtAuthAdapter` cannot see it. Without this gate a family issued before
    // a reset mints a NEW access token with a fresh `iat` and resurrects the
    // session the reset existed to kill — with every other test still green.

    it('refuses a family issued inside the reset second, and kills it', async () => {
      // The writer CEILS, so a reset at ...000.3 records ...001; a family
      // stamped ...000 is inside that second and must not survive.
      users.findAuthStateById.mockResolvedValue({
        id: 'user_1',
        passwordChangedAt: new Date((FAMILY_ISSUED_AT + 1) * 1000),
      });

      await expect(service.refresh('presented')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      // The family, not just this leaf: every sibling then fails its own next
      // use, which is revocation without an N-key delete.
      expect(store.revokeFamily).toHaveBeenCalledWith('fam_1');
    });

    it('accepts a family issued in the second after the reset', async () => {
      users.findAuthStateById.mockResolvedValue({
        id: 'user_1',
        passwordChangedAt: new Date(FAMILY_ISSUED_AT * 1000),
      });

      await expect(service.refresh('presented')).resolves.toMatchObject({
        accessToken: 'fresh.access.token',
      });
      expect(store.revokeFamily).not.toHaveBeenCalled();
    });

    it('refuses a deleted user and kills the family', async () => {
      users.findAuthStateById.mockResolvedValue(null);

      await expect(service.refresh('presented')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(store.revokeFamily).toHaveBeenCalledWith('fam_1');
      expect(issueToken).not.toHaveBeenCalled();
    });

    it('propagates a thrown Postgres read as a fault, NOT as 401', async () => {
      // A 401 here would sign out every active user over a thirty-second blip,
      // and they could not sign back in, because login needs the same database.
      users.findAuthStateById.mockRejectedValue(new Error('connection reset'));

      await expect(service.refresh('presented')).rejects.toThrow(
        'connection reset',
      );
      await expect(service.refresh('presented')).rejects.not.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('terminal verdicts', () => {
    it.each(['notfound', 'expired', 'revoked', 'orphaned'] as const)(
      'answers 401 for %s and mints nothing',
      async (outcome) => {
        store.rotate.mockResolvedValue({ outcome });

        await expect(service.refresh('presented')).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(issueToken).not.toHaveBeenCalled();
      },
    );

    it('leaves the family and every socket alone for an orphaned token', async () => {
      // The whole point of splitting this verdict off `reuse`. The server cannot
      // tell a lost successor from one the browser is holding, so an ordinary
      // late duplicate refresh must not drop that user's meeting on every
      // device and log a theft that never happened.
      store.rotate.mockResolvedValue({ outcome: 'orphaned' });

      await expect(service.refresh('presented')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(terminator.terminate).not.toHaveBeenCalled();
      expect(store.revokeFamily).not.toHaveBeenCalled();
    });

    it('closes that user`s live sockets on detected reuse', async () => {
      // Revoking the family while leaving the thief's socket streaming the
      // victim's audio is incomplete revocation.
      store.rotate.mockResolvedValue({ outcome: 'reuse', userId: 'user_1' });

      await expect(service.refresh('presented')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(terminator.terminate).toHaveBeenCalledWith('user_1');
    });

    it('does not read the user row on a terminal verdict', async () => {
      store.rotate.mockResolvedValue({ outcome: 'notfound' });
      await expect(service.refresh('presented')).rejects.toThrow();
      expect(users.findAuthStateById).not.toHaveBeenCalled();
    });
  });

  describe('an unreachable token store', () => {
    it('answers 503 — not 401, and not a bare 500', async () => {
      // 401 would be read by every client as proof the session is dead; a raw
      // node-redis error would render as 500 through the exceptions filter,
      // which says "your request broke something" rather than "try again".
      store.rotate.mockRejectedValue(new Error('The client is closed'));

      await expect(service.refresh('presented')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('signs nobody out when it cannot reach the store', async () => {
      store.rotate.mockRejectedValue(new Error('The client is closed'));
      await expect(service.refresh('presented')).rejects.toThrow();
      expect(terminator.terminate).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('ends the family the token belongs to', async () => {
      await service.revoke('a-token');
      expect(store.revokeByToken).toHaveBeenCalledWith('a-token');
    });

    it('does not close other devices` sockets', async () => {
      // The difference between a voluntary sign-out and detected theft.
      await service.revoke('a-token');
      expect(terminator.terminate).not.toHaveBeenCalled();
    });

    it('succeeds even when the store is unreachable', async () => {
      // Someone leaving must never be blocked by a failure they cannot act on;
      // the client clears its own state regardless.
      store.revokeByToken.mockRejectedValue(new Error('The client is closed'));
      await expect(service.revoke('a-token')).resolves.toBeUndefined();
    });

    it('succeeds for a token it has never seen', async () => {
      // Answering differently would make this an oracle for "is this token
      // still live".
      store.revokeByToken.mockResolvedValue(false);
      await expect(service.revoke('unknown')).resolves.toBeUndefined();
    });
  });
});

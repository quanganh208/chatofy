import { UnauthorizedException } from '@nestjs/common';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import type { PasswordHasher } from './password-hasher';
import type { GoogleTokenVerifier } from './google-token-verifier';
import type { AuthAdapter } from './interfaces/auth-adapter.interface';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import { mockUsers, realHasher, record } from './auth-flow.harness';

describe('AuthService', () => {
  let users: jest.Mocked<UserRepository>;
  let auth: jest.Mocked<AuthAdapter>;
  let google: jest.Mocked<GoogleTokenVerifier>;
  let hasher: PasswordHasher;
  let service: AuthService;

  beforeEach(() => {
    users = mockUsers();
    auth = {
      verifyToken: jest.fn(),
      getUser: jest.fn(),
      issueToken: jest.fn().mockResolvedValue('signed.jwt.value'),
    };
    google = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<GoogleTokenVerifier>;
    hasher = realHasher();
    service = new AuthService(users, auth, google, hasher);
  });

  describe('login', () => {
    const hashFor = (password: string) => argon2.hash(password);

    it('returns a session for the right password', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: await hashFor('right-password'),
        googleSub: null,
      });
      const session = await service.login({
        email: 'a@b.com',
        password: 'right-password',
      });
      expect(session.user.id).toBe('user_1');
      expect(session.token.accessToken).toBe('signed.jwt.value');
    });

    it('answers a wrong password and an unknown email identically', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: await hashFor('right-password'),
        googleSub: null,
      });
      const wrongPassword = await service
        .login({ email: 'a@b.com', password: 'wrong-password' })
        .catch((e: UnauthorizedException) => e);

      users.findCredentialsByEmail.mockResolvedValue(null);
      const unknownEmail = await service
        .login({ email: 'nobody@b.com', password: 'wrong-password' })
        .catch((e: UnauthorizedException) => e);

      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
      expect((unknownEmail as UnauthorizedException).getStatus()).toBe(
        (wrongPassword as UnauthorizedException).getStatus(),
      );
      expect((unknownEmail as UnauthorizedException).message).toBe(
        (wrongPassword as UnauthorizedException).message,
      );
    });

    it('still spends a verify on an unknown email, so timing does not answer what the message refuses to', async () => {
      users.findCredentialsByEmail.mockResolvedValue(null);

      const started = performance.now();
      await service
        .login({ email: 'nobody@b.com', password: 'anything' })
        .catch(() => undefined);
      const elapsed = performance.now() - started;

      // Asserted as a floor on elapsed time rather than a spy, because argon2's
      // exports are non-configurable and cannot be spied on. The margin is
      // wide: an argon2id verify at the default 64 MiB does not finish in under
      // ~20 ms on any machine this runs on, while returning early on a missing
      // row is sub-millisecond. A loaded runner only pushes this further above
      // the floor, so the check gets safer under load, not flakier.
      expect(elapsed).toBeGreaterThan(20);
    });

    it('refuses a Google-first row that has no password at all', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: null,
        googleSub: null,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'anything' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('treats a corrupt stored hash as a failure, not a crash', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: 'not-an-argon2-hash',
        googleSub: null,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'anything' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('email normalisation', () => {
    it('signs in the same person whatever case they type', async () => {
      users.findCredentialsByEmail.mockResolvedValue(null);
      await service
        .login({ email: 'ALICE@CORP.COM', password: 'x' })
        .catch(() => undefined);
      expect(users.findCredentialsByEmail.mock.calls[0]?.[0]).toBe(
        'alice@corp.com',
      );
    });

    it('looks a Google identity up by the same folded address', async () => {
      // Without this the lookup misses the existing row and silently creates a
      // SECOND account for the same person.
      google.verify.mockResolvedValue({
        sub: 'google-sub-1',
        email: 'Alice@Corp.com',
        emailVerified: true,
      });
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record());

      await service.loginWithGoogle('id.token');
      expect(users.findCredentialsByEmail.mock.calls[0]?.[0]).toBe(
        'alice@corp.com',
      );
      expect(users.create.mock.calls[0]?.[0].email).toBe('alice@corp.com');
    });
  });

  describe('the session it mints', () => {
    /**
     * Driven through LOGIN rather than register.
     *
     * Register no longer mints a session — it creates no account — so login is
     * now the shortest path to the one place a session is built. The claims
     * under test are about `sessionFor`, which all three entry points share.
     */
    const loginWith = async (user = record()) => {
      users.findCredentialsByEmail.mockResolvedValue({
        user,
        passwordHash: await argon2.hash('right-password'),
        googleSub: null,
      });
      return service.login({ email: 'a@b.com', password: 'right-password' });
    };

    it('parses against a STRICT user schema — the mechanical proof no hash leaks', async () => {
      const session = await loginWith();

      // .strict() is the point: a plain parse would ignore an extra
      // passwordHash key rather than fail on it.
      expect(() => userSchema.strict().parse(session.user)).not.toThrow();
      expect(JSON.stringify(session)).not.toContain('passwordHash');
      // And the revocation column the auth path now reads on every request.
      expect(JSON.stringify(session)).not.toContain('passwordChangedAt');
    });

    it('normalises the record shape the wire contract does not share', async () => {
      const session = await loginWith(record({ name: undefined }));
      // UserRecord has name?: string and createdAt: Date; the contract
      // wants name nullable and createdAt a string.
      expect(session.user.name).toBeNull();
      expect(typeof session.user.createdAt).toBe('string');
    });

    it('omits refreshToken and dates expiresAt by the token lifetime', async () => {
      const before = Date.now();
      const session = await loginWith();

      expect('refreshToken' in session.token).toBe(false);
      const expiresAt = new Date(session.token.expiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(
        before + ACCESS_TOKEN_TTL_SECONDS * 1000,
      );
      expect(expiresAt).toBeLessThanOrEqual(
        Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
      );
    });
  });
});

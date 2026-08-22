import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import type { AuthAdapter } from './interfaces/auth-adapter.interface';
import type {
  UserRecord,
  UserRepository,
} from '../users/interfaces/user-repository.interface';

function record(over: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    email: 'a@b.com',
    displayName: 'A',
    preferredLanguage: 'vi',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('AuthService', () => {
  let users: jest.Mocked<UserRepository>;
  let auth: jest.Mocked<AuthAdapter>;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByGoogleSub: jest.fn(),
      findCredentialsByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      linkGoogleSub: jest.fn(),
    };
    auth = {
      verifyToken: jest.fn(),
      getUser: jest.fn(),
      issueToken: jest.fn().mockResolvedValue('signed.jwt.value'),
    };
    service = new AuthService(users, auth);
  });

  describe('register', () => {
    it('stores an argon2 hash of the password, never the password', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record());

      await service.register({
        email: 'a@b.com',
        password: 'correct horse battery',
        displayName: 'A',
      });

      const hash = users.create.mock.calls[0]?.[0].passwordHash;
      expect(hash).toBeDefined();
      expect(hash).not.toContain('correct horse battery');
      expect(hash!.startsWith('$argon2')).toBe(true);
      await expect(argon2.verify(hash!, 'correct horse battery')).resolves.toBe(
        true,
      );
    });

    it('refuses an email that already has an account', async () => {
      users.findByEmail.mockResolvedValue(record());
      await expect(
        service.register({
          email: 'a@b.com',
          password: 'whatever-long-enough',
          displayName: 'A',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.create.mock.calls).toHaveLength(0);
    });
  });

  describe('login', () => {
    const hashFor = (password: string) => argon2.hash(password);

    it('returns a session for the right password', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: await hashFor('right-password'),
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
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'anything' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('treats a corrupt stored hash as a failure, not a crash', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: 'not-an-argon2-hash',
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'anything' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('the session it mints', () => {
    it('parses against a STRICT user schema — the mechanical proof no hash leaks', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record());
      const session = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        displayName: 'A',
      });

      // .strict() is the point: a plain parse would ignore an extra
      // passwordHash key rather than fail on it.
      expect(() => userSchema.strict().parse(session.user)).not.toThrow();
      expect(JSON.stringify(session)).not.toContain('passwordHash');
    });

    it('normalises the record shape the wire contract does not share', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record({ displayName: undefined }));
      const session = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        displayName: 'A',
      });
      // UserRecord has displayName?: string and createdAt: Date; the contract
      // wants displayName nullable and createdAt a string.
      expect(session.user.displayName).toBeNull();
      expect(typeof session.user.createdAt).toBe('string');
    });

    it('omits refreshToken and dates expiresAt by the token lifetime', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record());
      const before = Date.now();
      const session = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        displayName: 'A',
      });

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

  describe('findMe', () => {
    it('reads the profile fresh rather than trusting the token', async () => {
      users.findById.mockResolvedValue(record({ displayName: 'Renamed' }));
      await expect(service.findMe('user_1')).resolves.toMatchObject({
        id: 'user_1',
        displayName: 'Renamed',
      });
    });

    it('refuses a token whose user has been deleted', async () => {
      users.findById.mockResolvedValue(null);
      await expect(service.findMe('gone')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});

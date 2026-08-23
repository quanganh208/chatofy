import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import type { GoogleTokenVerifier } from './google-token-verifier';
import type { AuthAdapter } from './interfaces/auth-adapter.interface';
import type {
  UserRecord,
  UserRepository,
} from '../users/interfaces/user-repository.interface';
import { UserAlreadyExistsError } from '../users/interfaces/user-repository.interface';

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
  let google: jest.Mocked<GoogleTokenVerifier>;
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
    google = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<GoogleTokenVerifier>;
    service = new AuthService(users, auth, google);
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

    /**
     * The existence check is not a lock: two registrations of one address both
     * pass it and both insert, and the unique index refuses the loser. That
     * refusal used to escape the filter as INTERNAL_ERROR, telling someone the
     * server broke when the truthful answer — the same one the sequential path
     * gives — is that the address is taken.
     */
    it('answers a lost insert race the way it answers a taken email', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue(new UserAlreadyExistsError('email'));

      const attempt = service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        displayName: 'A',
      });

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      // Indistinguishable from the checked path, deliberately — a client cannot
      // branch on a message it only sees when it loses a race.
      await expect(attempt).rejects.toThrow('That email is already registered');
    });

    it('lets a fault that is not a duplicate keep its identity', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue(new Error('connection terminated'));

      const attempt = service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        displayName: 'A',
      });

      // A dropped connection is a 500 and must stay one. Reporting it as a
      // conflict would tell the caller to pick another address over a fault
      // that has nothing to do with the one they chose.
      await expect(attempt).rejects.not.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow('connection terminated');
    });
  });

  describe('email normalisation', () => {
    it('registers and logs in the same person whatever case they type', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record());
      await service.register({
        email: '  Alice@Corp.com ',
        password: 'a-long-enough-password',
        displayName: 'A',
      });
      expect(users.create.mock.calls[0]?.[0].email).toBe('alice@corp.com');

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

  describe('loginWithGoogle', () => {
    const identity = {
      sub: 'google-sub-1',
      email: 'a@b.com',
      emailVerified: true,
      displayName: 'A',
    };

    beforeEach(() => google.verify.mockResolvedValue(identity));

    it('logs in a known Google identity without looking at the email at all', async () => {
      users.findByGoogleSub.mockResolvedValue(record());
      const session = await service.loginWithGoogle('id.token');
      expect(session.user.id).toBe('user_1');
      // googleSub is unique and never reassigned, so the email is not evidence
      // of anything once it has matched.
      expect(users.findCredentialsByEmail.mock.calls).toHaveLength(0);
    });

    it('creates a passwordless account when nobody holds that email', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(record());

      await service.loginWithGoogle('id.token');
      const dto = users.create.mock.calls[0]?.[0];
      expect(dto?.googleSub).toBe('google-sub-1');
      expect(dto?.passwordHash).toBeUndefined();
    });

    /**
     * Reached only on an account's FIRST Google sign-in — every later one
     * returns at `findByGoogleSub`. Two of those firsts racing meant the loser
     * got INTERNAL_ERROR for a state that resolves itself: the winner's row now
     * carries this `sub`, so retrying signs in.
     */
    it('tells a lost first-sign-in race to retry rather than reporting a fault', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue(new UserAlreadyExistsError('googleSub'));

      const attempt = service.loginWithGoogle('id.token');
      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow('try again');
    });

    it('reports a racing duplicate on the email the same way', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue(new UserAlreadyExistsError('email'));

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lets a fault that is not a duplicate keep its identity', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue(null);
      users.create.mockRejectedValue(new Error('connection terminated'));

      const attempt = service.loginWithGoogle('id.token');
      await expect(attempt).rejects.not.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow('connection terminated');
    });

    it('links a passwordless row that Google has verified', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: null,
        googleSub: null,
      });
      users.linkGoogleSub.mockResolvedValue(record());

      await service.loginWithGoogle('id.token');
      expect(users.linkGoogleSub.mock.calls[0]).toEqual([
        'user_1',
        'google-sub-1',
      ]);
    });

    it('refuses a row already linked to a DIFFERENT Google identity', async () => {
      // Reached when an address is recycled: a Workspace account is deleted and
      // the same address issued to someone new, who gets a new `sub` for it.
      // Google's durable key is `sub`, not the address, so relinking would hand
      // the new holder the previous person's sessions and transcripts.
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: null,
        googleSub: 'the-previous-holders-sub',
      });

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(users.linkGoogleSub.mock.calls).toHaveLength(0);
    });

    it('refuses when another login claimed the row between the read and the write', async () => {
      // The write is conditional and returns null rather than overwriting.
      // Whoever won the race may have been a different identity and this
      // request cannot tell, so it refuses instead of issuing a session for a
      // row it did not actually link.
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: null,
        googleSub: null,
      });
      users.linkGoogleSub.mockResolvedValue(null);

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('REFUSES to auto-link a row that already has a password', async () => {
      // The squatting defence. Registration proves no mailbox control, so an
      // attacker can hold victim@company.com with a password of their choosing;
      // auto-linking here would log the real owner into the attacker's row and
      // leave the attacker's password in place.
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: '$argon2id$v=19$whatever',
        googleSub: null,
      });

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(users.linkGoogleSub.mock.calls).toHaveLength(0);
      expect(users.create.mock.calls).toHaveLength(0);
    });

    it('checks the password BEFORE the verified-email flag, so an unverified token cannot probe it differently', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: '$argon2id$v=19$whatever',
        googleSub: null,
      });
      google.verify.mockResolvedValue({ ...identity, emailVerified: false });

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(users.linkGoogleSub.mock.calls).toHaveLength(0);
    });

    it('refuses an unverified email against an existing passwordless row', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: null,
        googleSub: null,
      });
      google.verify.mockResolvedValue({ ...identity, emailVerified: false });

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.linkGoogleSub.mock.calls).toHaveLength(0);
    });

    it('refuses to CREATE an account from an unverified email', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findCredentialsByEmail.mockResolvedValue(null);
      google.verify.mockResolvedValue({ ...identity, emailVerified: false });

      await expect(service.loginWithGoogle('id.token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.create.mock.calls).toHaveLength(0);
    });

    it('returns a session shaped exactly like a password login', async () => {
      users.findByGoogleSub.mockResolvedValue(record());
      const viaGoogle = await service.loginWithGoogle('id.token');

      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: await argon2.hash('right-password'),
        googleSub: null,
      });
      const viaPassword = await service.login({
        email: 'a@b.com',
        password: 'right-password',
      });

      expect(Object.keys(viaGoogle).sort()).toEqual(
        Object.keys(viaPassword).sort(),
      );
      expect(Object.keys(viaGoogle.token).sort()).toEqual(
        Object.keys(viaPassword.token).sort(),
      );
      expect(() => userSchema.strict().parse(viaGoogle.user)).not.toThrow();
    });
  });
});

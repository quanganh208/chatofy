import { UnauthorizedException } from '@nestjs/common';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import type { PasswordHasher } from './password-hasher';
import type { GoogleTokenVerifier } from './google-token-verifier';
import type { AuthAdapter } from './interfaces/auth-adapter.interface';
import type {
  UserRecord,
  UserRepository,
} from '../users/interfaces/user-repository.interface';
import {
  FakeAvatarStorage,
  mockUsers,
  realHasher,
  record,
  stubConfig,
} from './auth-flow.harness';

const BASE = 'https://cdn.example.com';

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
    service = new AuthService(
      users,
      auth,
      google,
      hasher,
      stubConfig(),
      new FakeAvatarStorage(),
    );
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

  /**
   * The Google picture import.
   *
   * Every case here is really one question: can this cost somebody their
   * sign-in? The answer has to be no for a rejecting fetch, a non-image, an
   * unconfigured bucket and a wrong host alike — so each is asserted as a full
   * session returned, not merely as an absent avatar.
   */
  describe('Google avatar import', () => {
    const PICTURE = 'https://lh3.googleusercontent.com/a/xyz';
    const identity = {
      sub: 'google-sub-1',
      email: 'a@b.com',
      emailVerified: true,
      picture: PICTURE,
    };

    let fetchMock: jest.SpyInstance;

    /** WebP signature bytes, which is what the sniff actually reads. */
    const webpBytes = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'ascii'),
      Buffer.from('a', 'ascii'),
    ]);

    const rebuild = (avatars: FakeAvatarStorage) => {
      service = new AuthService(
        users,
        auth,
        google,
        hasher,
        stubConfig(BASE),
        avatars,
      );
    };

    /** Makes the repository accept the avatar write and hand the row back. */
    const acceptWrites = (initial = record()) => {
      let row = initial;
      users.updateAvatarKey.mockImplementation(async (_id, key, changedAt) => {
        row = {
          ...row,
          ...(key === null ? {} : { avatarKey: key }),
          avatarChangedAt: changedAt,
        };
        return row;
      });
      users.findById.mockImplementation(async () => row);
      return () => row;
    };

    beforeEach(() => {
      rebuild(new FakeAvatarStorage());
      google.verify.mockResolvedValue(identity);
      fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(new Uint8Array(webpBytes)));
    });
    afterEach(() => fetchMock.mockRestore());

    /** The three terminal returns of loginWithGoogle, each reached on its own. */
    const branches: Array<[string, (row: UserRecord) => void]> = [
      [
        'a known googleSub',
        (row) => {
          users.findByGoogleSub.mockResolvedValue(row);
        },
      ],
      [
        'a freshly created account',
        (row) => {
          users.findByGoogleSub.mockResolvedValue(null);
          users.findCredentialsByEmail.mockResolvedValue(null);
          users.create.mockResolvedValue(row);
        },
      ],
      [
        'a passwordless row linked just now',
        (row) => {
          users.findByGoogleSub.mockResolvedValue(null);
          users.findCredentialsByEmail.mockResolvedValue({
            user: row,
            passwordHash: null,
            googleSub: null,
          });
          users.linkGoogleSub.mockResolvedValue(row);
        },
      ],
    ];

    it.each(branches)('imports on %s', async (_label, arrange) => {
      // Three insertion points, so three cases. A single "fresh account" test
      // would pass while a whole branch silently never imported.
      const fresh = record();
      arrange(fresh);
      const current = acceptWrites(fresh);

      const session = await service.loginWithGoogle('id.token');

      expect(current().avatarKey).toMatch(/^avatars\//);
      // In the LOGIN RESPONSE itself, not only on a later getMe — the wrapper
      // runs before sessionFor, which is what makes that true.
      expect(session.user.avatarUrl).toBe(`${BASE}/${current().avatarKey}`);
    });

    it('never imports again once the row has been stamped', async () => {
      // Including a row whose avatar was REMOVED: that also leaves a null key,
      // and re-importing would leave a Google user unable to have no picture.
      const stamped = record({ avatarChangedAt: new Date('2026-02-01') });
      users.findByGoogleSub.mockResolvedValue(stamped);
      acceptWrites(stamped);

      await service.loginWithGoogle('id.token');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(users.updateAvatarKey.mock.calls.length).toBe(0);
    });

    it('does not fetch at all when storage is unconfigured', async () => {
      // The gate is `avatarChangedAt`, which only a COMPLETED write stamps — so
      // without this check an R2-less deployment would repeat the outbound fetch
      // and the doomed put on EVERY Google sign-in, forever. "At most once per
      // row" would silently mean "at most one success".
      rebuild(new FakeAvatarStorage(false));
      users.findByGoogleSub.mockResolvedValue(record());
      acceptWrites();

      const session = await service.loginWithGoogle('id.token');

      expect(fetchMock).not.toHaveBeenCalled();
      expect(session.token.accessToken).toBe('signed.jwt.value');
    });

    it("leaves a user's own uploaded avatar alone", async () => {
      const owned = record({
        avatarKey: 'avatars/user_1/mine.webp',
        avatarChangedAt: new Date('2026-02-01'),
      });
      users.findByGoogleSub.mockResolvedValue(owned);
      acceptWrites(owned);

      const session = await service.loginWithGoogle('id.token');

      expect(session.user.avatarUrl).toBe(`${BASE}/avatars/user_1/mine.webp`);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not fetch when the token carries no picture', async () => {
      google.verify.mockResolvedValue({ ...identity, picture: undefined });
      users.findByGoogleSub.mockResolvedValue(record());
      acceptWrites();

      await service.loginWithGoogle('id.token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the fetch rejects',
        () => fetchMock.mockRejectedValue(new Error('ECONNREFUSED')),
      ],
      [
        'the response is not an image',
        () =>
          fetchMock.mockResolvedValue(
            new Response(new Uint8Array(Buffer.from('<html>'))),
          ),
      ],
      [
        'the host is not a Google host',
        () =>
          google.verify.mockResolvedValue({
            ...identity,
            picture: 'https://evilgoogleusercontent.com/a/xyz',
          }),
      ],
      ['storage is unconfigured', () => rebuild(new FakeAvatarStorage(false))],
    ])('still returns a full session when %s', async (_label, arrange) => {
      users.findByGoogleSub.mockResolvedValue(record());
      acceptWrites();
      arrange();

      const session = await service.loginWithGoogle('id.token');

      expect(session.token.accessToken).toBe('signed.jwt.value');
      expect(session.user.id).toBe('user_1');
      expect(session.user.avatarUrl).toBeNull();
    });

    it('performs zero outbound fetches on a PASSWORD login', async () => {
      // sessionFor is shared by both paths, which is exactly why the import is
      // NOT hooked there — it would put a 3s outbound call on every sign-in.
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: await argon2.hash('right-password'),
        googleSub: null,
      });

      await service.login({ email: 'a@b.com', password: 'right-password' });
      expect(fetchMock).not.toHaveBeenCalled();
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

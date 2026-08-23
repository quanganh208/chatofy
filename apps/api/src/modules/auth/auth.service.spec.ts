import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { userSchema } from '@chatofy/types';
import * as argon2 from 'argon2';
import {
  MailBudgetClass,
  MailPurpose,
  type MailDispatch,
  type MailSender,
} from '../mail/interfaces/mail-sender.interface';
import { ACCESS_TOKEN_TTL_SECONDS, AuthService } from './auth.service';
import { PurposeTokenService } from './purpose-token';
import { SessionTerminator } from './session-terminator';
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
    name: 'A',
    preferredLanguage: 'vi',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

const SECRET = 'a-test-secret-long-enough-for-the-schema';

/**
 * Every mail the service dispatched.
 *
 * Sends are DETACHED — awaiting one would make response time an
 * account-existence oracle — so a test that wants to see one has to let the
 * microtask queue drain first. `settle()` below is that wait, and it is why
 * these assertions never race the code they cover.
 */
class RecordingMailSender implements MailSender {
  readonly sent: MailDispatch[] = [];
  async send(dispatch: MailDispatch): Promise<void> {
    this.sent.push(dispatch);
  }
}

/** Lets the detached dispatch chains run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AuthService', () => {
  let users: jest.Mocked<UserRepository>;
  let auth: jest.Mocked<AuthAdapter>;
  let google: jest.Mocked<GoogleTokenVerifier>;
  let mail: RecordingMailSender;
  let tokens: PurposeTokenService;
  let terminator: SessionTerminator;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByGoogleSub: jest.fn(),
      findCredentialsByEmail: jest.fn(),
      findAuthStateById: jest.fn(),
      findCredentialsById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      linkGoogleSub: jest.fn(),
      updatePasswordHash: jest.fn(),
    };
    auth = {
      verifyToken: jest.fn(),
      getUser: jest.fn(),
      issueToken: jest.fn().mockResolvedValue('signed.jwt.value'),
    };
    google = {
      verify: jest.fn(),
    } as unknown as jest.Mocked<GoogleTokenVerifier>;
    mail = new RecordingMailSender();
    // A real PurposeTokenService and a real SessionTerminator: both are pure and
    // dependency-free, and the token derivation is exactly the part a mock would
    // stop proving.
    tokens = new PurposeTokenService(new JwtService({ secret: SECRET }), {
      get: () => SECRET,
    } as unknown as ConfigService<never, true>);
    terminator = new SessionTerminator();
    service = new AuthService(users, auth, google, mail, tokens, terminator, {
      get: () => 'http://localhost:3001',
    } as unknown as ConfigService<never, true>);
  });

  describe('register', () => {
    it('creates NO row, whatever the address', async () => {
      // The whole design. An unverified row is what reopens the existence
      // oracle, so there must not be one to find.
      users.findByEmail.mockResolvedValue(null);

      await service.register({
        email: 'a@b.com',
        password: 'correct horse battery',
        name: 'A',
      });
      await settle();

      expect(users.create.mock.calls).toHaveLength(0);
    });

    it('answers a fresh and a taken address byte for byte identically', async () => {
      users.findByEmail.mockResolvedValue(null);
      const fresh = await service.register({
        email: 'fresh@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });

      users.findByEmail.mockResolvedValue(record());
      const taken = await service.register({
        email: 'taken@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });

      expect(taken).toEqual(fresh);
      expect(JSON.stringify(taken)).toBe(JSON.stringify(fresh));
    });

    /**
     * The timing defence, asserted STRUCTURALLY.
     *
     * A `|Δt| < ε` assertion either flakes on a shared runner — argon2 is 64 MiB
     * on the same threadpool as the translate pipeline — or needs an epsilon so
     * wide it proves nothing. A flaky security test gets skipped, which is worse
     * than no test. Call order is exact and cannot flake.
     */
    it('hashes the password BEFORE the existence check, even for a taken address', async () => {
      users.findByEmail.mockResolvedValue(record());
      const hashSpy = jest.spyOn(
        service as unknown as { hashPassword: (p: string) => Promise<string> },
        'hashPassword',
      );

      await service.register({
        email: 'taken@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });

      expect(hashSpy.mock.calls.length).toBeGreaterThan(0);
      expect(users.findByEmail.mock.calls.length).toBeGreaterThan(0);
      // Someone will notice that hashing a duplicate's password is "wasted" work
      // and reorder it. This is the assertion that stops them.
      expect(hashSpy.mock.invocationCallOrder[0]!).toBeLessThan(
        users.findByEmail.mock.invocationCallOrder[0]!,
      );
    });

    it('mails a verification link for a fresh address', async () => {
      users.findByEmail.mockResolvedValue(null);
      await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });
      await settle();

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.purpose).toBe(MailPurpose.VerifyEmail);
      // Attacker-class: the caller invented this address and no row exists for
      // it, so it must not be able to draw down the allowance password reset
      // depends on. See MailBudgetClass.
      expect(mail.sent[0]!.budgetClass).toBe(
        MailBudgetClass.AttackerTriggerable,
      );
      expect(mail.sent[0]!.to).toBe('a@b.com');
      expect(mail.sent[0]!.link).toContain('/verify-email?token=');
      // Never `undefined/…`: the origin comes from configuration, with a default.
      expect(mail.sent[0]!.link.startsWith('http://localhost:3001')).toBe(true);
    });

    it('mails an account-exists notice for a taken address, from the attacker-class budget', async () => {
      users.findByEmail.mockResolvedValue(record());
      await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });
      await settle();

      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0]!.purpose).toBe(MailPurpose.AccountExistsNotice);
      // Anyone can trigger this by naming any address, so it must not be able to
      // starve the allowance real verifications and resets draw from.
      expect(mail.sent[0]!.budgetClass).toBe(
        MailBudgetClass.AttackerTriggerable,
      );
    });

    it('answers without waiting for the send to finish', async () => {
      // The property, asserted against a send that never completes: awaiting one
      // would make response time the oracle the uniform status just closed —
      // microseconds for a branch that sends nothing versus a whole SMTP round
      // trip for one that does. A reviewer or a lint rule asking for the missing
      // `await` is asking to re-open that side channel.
      users.findByEmail.mockResolvedValue(null);
      let release!: () => void;
      jest.spyOn(mail, 'send').mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const answered = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });
      expect(typeof answered.message).toBe('string');

      release();
    });

    it('carries no user-supplied text into the dispatch', async () => {
      // `name` has no maximum and no charset restriction, and register
      // mails an address the CALLER names on an unauthenticated request. A
      // greeting built from it would let anyone send chosen text to any address
      // from the project's own SPF/DKIM-aligned account.
      users.findByEmail.mockResolvedValue(null);
      await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: '\n\nSecurity alert: confirm at https://evil.tld\n\n',
      });
      await settle();

      expect(JSON.stringify(mail.sent[0])).not.toContain('evil.tld');
      // The interface has no field for free-form text at all — this holds by
      // construction, and this assertion is what notices if one is ever added.
      expect(Object.keys(mail.sent[0]!).sort()).toEqual([
        'budgetClass',
        'link',
        'purpose',
        'to',
      ]);
    });

    it('still answers when the mail cannot be sent', async () => {
      // The HTTP answer must not vary with whether the mail got out — that would
      // report which branch ran.
      users.findByEmail.mockResolvedValue(null);
      jest.spyOn(mail, 'send').mockRejectedValue(new Error('smtp is down'));

      const answered = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
      });
      expect(typeof answered.message).toBe('string');
      await settle();
    });
  });

  describe('verifyEmail', () => {
    const pendingToken = (over: Partial<Record<string, string>> = {}) =>
      tokens.issueRegistration({
        email: 'a@b.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
        name: 'A',
        ...over,
      });

    it('creates the account the link describes', async () => {
      users.create.mockResolvedValue(record());
      const result = await service.verifyEmail({ token: await pendingToken() });

      expect(users.create.mock.calls[0]?.[0]).toEqual({
        email: 'a@b.com',
        name: 'A',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
      });
      expect(result.message).toContain('ready');
    });

    it('signs nobody in', async () => {
      // No session comes back: the account was just created and its password was
      // never typed on this request.
      users.create.mockResolvedValue(record());
      const result = await service.verifyEmail({ token: await pendingToken() });
      expect(Object.keys(result)).toEqual(['message']);
    });

    it('says the account already exists when the link is followed twice', async () => {
      // Ordinary: mail clients double-click, and scanners follow links unasked.
      // The second redemption legitimately loses to the unique index, and that
      // is not an error the reader can act on.
      users.create.mockRejectedValue(new UserAlreadyExistsError('email'));
      const result = await service.verifyEmail({ token: await pendingToken() });
      expect(result.message).toContain('already exists');
    });

    it('lets a fault that is not a duplicate keep its identity', async () => {
      // A dropped connection must NOT be reported as a bad link, which would
      // send the user round a loop that cannot succeed.
      users.create.mockRejectedValue(new Error('connection terminated'));
      await expect(
        service.verifyEmail({ token: await pendingToken() }),
      ).rejects.toThrow('connection terminated');
    });

    it('refuses a token that is not a verification link', async () => {
      const reset = await tokens.issuePasswordReset('user_1', null);
      await expect(
        service.verifyEmail({ token: reset }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.create.mock.calls).toHaveLength(0);
    });

    it('refuses garbage', async () => {
      await expect(
        service.verifyEmail({ token: 'not-a-jwt' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('email normalisation', () => {
    it('registers and logs in the same person whatever case they type', async () => {
      users.findByEmail.mockResolvedValue(null);
      await service.register({
        email: '  Alice@Corp.com ',
        password: 'a-long-enough-password',
        name: 'A',
      });
      // The folded address is what the existence check asks about, and what the
      // verification link is later minted for.
      expect(users.findByEmail.mock.calls[0]?.[0]).toBe('alice@corp.com');

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

  describe('forgotPassword', () => {
    it('answers a known and an unknown address identically', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: '$argon2-a-hash',
        googleSub: null,
      });
      const known = await service.forgotPassword({ email: 'a@b.com' });

      users.findCredentialsByEmail.mockResolvedValue(null);
      const unknown = await service.forgotPassword({ email: 'nobody@b.com' });

      expect(JSON.stringify(unknown)).toBe(JSON.stringify(known));
    });

    it('mails a reset link from the reserved allowance for a known address', async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record(),
        passwordHash: '$argon2-a-hash',
        googleSub: null,
      });
      await service.forgotPassword({ email: 'a@b.com' });
      await settle();

      expect(mail.sent[0]!.purpose).toBe(MailPurpose.PasswordReset);
      // The ONLY reserved class: this mail is sent only to a row that already
      // exists, so an attacker cannot conjure it by naming addresses — which is
      // exactly what makes it the one thing a ceiling can genuinely protect.
      expect(mail.sent[0]!.budgetClass).toBe(MailBudgetClass.Reserved);
      expect(mail.sent[0]!.link).toContain('/reset-password?token=');
    });

    it('draws the no-account notice from the attacker-class budget', async () => {
      users.findCredentialsByEmail.mockResolvedValue(null);
      await service.forgotPassword({ email: 'nobody@b.com' });
      await settle();

      expect(mail.sent[0]!.purpose).toBe(MailPurpose.NoAccountNotice);
      expect(mail.sent[0]!.budgetClass).toBe(
        MailBudgetClass.AttackerTriggerable,
      );
    });

    it('folds the address before looking it up', async () => {
      // Without this `Alice@corp.com` could never reset the row stored as
      // `alice@corp.com` — and the failure is SILENT, because the answer is
      // uniform either way and the user just waits for a mail nobody sent.
      users.findCredentialsByEmail.mockResolvedValue(null);
      await service.forgotPassword({ email: '  Alice@Corp.com ' });
      expect(users.findCredentialsByEmail.mock.calls[0]?.[0]).toBe(
        'alice@corp.com',
      );
    });

    it('answers without waiting for the send to finish', async () => {
      // Same property as register's, and it matters more here: the known branch
      // opens an SMTP connection and the unknown one does far less, so an
      // awaited send would time-stamp which of the two ran.
      users.findCredentialsByEmail.mockResolvedValue(null);
      let release!: () => void;
      jest.spyOn(mail, 'send').mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const answered = await service.forgotPassword({
        email: 'nobody@b.com',
      });
      expect(typeof answered.message).toBe('string');

      release();
    });
  });

  describe('resetPassword', () => {
    const HASH = '$argon2id$v=19$m=65536,t=3,p=4$abc$def';

    const credentials = (passwordHash: string | null = HASH) => ({
      user: record(),
      passwordHash,
      googleSub: null,
    });

    it('writes the new hash and a ceiled timestamp in one call', async () => {
      users.findCredentialsById.mockResolvedValue(credentials());
      users.updatePasswordHash.mockResolvedValue(record());
      const token = await tokens.issuePasswordReset('user_1', HASH);

      await service.resetPassword({ token, password: 'a-brand-new-password' });

      const [id, hash, changedAt] = users.updatePasswordHash.mock.calls[0]!;
      expect(id).toBe('user_1');
      expect(hash.startsWith('$argon2')).toBe(true);
      await expect(argon2.verify(hash, 'a-brand-new-password')).resolves.toBe(
        true,
      );
      // Ceiled to a whole second. Truncating down would leave every token minted
      // during this second alive for its full seven days.
      expect(changedAt.getTime() % 1000).toBe(0);
      expect(changedAt.getTime()).toBeGreaterThanOrEqual(Date.now() - 1000);
    });

    it('stamps the timestamp AFTER hashing, not before', async () => {
      /**
       * The old password keeps working until the write commits, so anything
       * spent between taking the stamp and committing widens the band of tokens
       * that outlive the reset. Hashing is ~100 ms of exactly that.
       *
       * Driven with a controlled clock rather than by measuring, because the bug
       * is only observable when the hash happens to cross a second boundary —
       * about one reset in ten — and a test that catches a real defect one run in
       * ten reports the defect as fixed.
       *
       * The clock starts on an exact second and the hash advances it 900 ms.
       * Stamping after the hash ceils to the NEXT second; stamping before ceils
       * to the current one, and every token minted in between survives seven
       * days. Real wall-clock values, so JWT verification still behaves.
       */
      users.findCredentialsById.mockResolvedValue(credentials());
      users.updatePasswordHash.mockResolvedValue(record());
      const token = await tokens.issuePasswordReset('user_1', HASH);

      const base = Math.ceil(Date.now() / 1000) * 1000;
      let now = base;
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
      jest
        .spyOn(
          service as unknown as {
            hashPassword: (p: string) => Promise<string>;
          },
          'hashPassword',
        )
        .mockImplementation(async () => {
          now = base + 900;
          return '$argon2-the-new-hash';
        });

      try {
        await service.resetPassword({
          token,
          password: 'a-brand-new-password',
        });
      } finally {
        nowSpy.mockRestore();
      }

      const changedAt = users.updatePasswordHash.mock.calls[0]![2];
      expect(changedAt.getTime()).toBe(base + 1000);
    });

    it('signs nobody in', async () => {
      users.findCredentialsById.mockResolvedValue(credentials());
      users.updatePasswordHash.mockResolvedValue(record());
      const token = await tokens.issuePasswordReset('user_1', HASH);

      const result = await service.resetPassword({
        token,
        password: 'a-brand-new-password',
      });
      // Handing back a token here would make it the one credential exempt from
      // the invalidation this reset just performed.
      expect(Object.keys(result)).toEqual(['message']);
    });

    it('closes the sockets that user still holds open', async () => {
      const closeSessionsFor = jest.fn<number, [string]>().mockReturnValue(2);
      terminator.register({ closeSessionsFor });
      users.findCredentialsById.mockResolvedValue(credentials());
      users.updatePasswordHash.mockResolvedValue(record());
      const token = await tokens.issuePasswordReset('user_1', HASH);

      await service.resetPassword({ token, password: 'a-brand-new-password' });
      expect(closeSessionsFor.mock.calls[0]?.[0]).toBe('user_1');
    });

    it('refuses a token whose row now holds a different hash', async () => {
      // Single use, a second reset, and a superseded link are all this one fact.
      users.findCredentialsById.mockResolvedValue(
        credentials('$argon2-the-hash-it-was-changed-to'),
      );
      const token = await tokens.issuePasswordReset('user_1', HASH);

      await expect(
        service.resetPassword({ token, password: 'a-brand-new-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.updatePasswordHash.mock.calls).toHaveLength(0);
    });

    it('refuses a token naming a row that no longer exists', async () => {
      users.findCredentialsById.mockResolvedValue(null);
      const token = await tokens.issuePasswordReset('user_1', HASH);
      await expect(
        service.resetPassword({ token, password: 'a-brand-new-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses an access token presented as a reset link', async () => {
      // The `:pwreset:` infix is what stops this. Asserted for a null-hash row
      // specifically — that is the case where a naive derivation collapses onto
      // the bare app secret.
      users.findCredentialsById.mockResolvedValue(credentials(null));
      const accessToken = await new JwtService({ secret: SECRET }).signAsync({
        sub: 'user_1',
      });
      await expect(
        service.resetPassword({
          token: accessToken,
          password: 'a-brand-new-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lets a Google-first row with no password reset one', async () => {
      // Deliberately allowed: only someone holding the mailbox reaches here, the
      // same proof Google's `emailVerified` attested. And the answer does not
      // branch on account type, which would be an account-shape oracle.
      users.findCredentialsById.mockResolvedValue(credentials(null));
      users.updatePasswordHash.mockResolvedValue(record());
      const token = await tokens.issuePasswordReset('user_1', null);

      const answered = await service.resetPassword({
        token,
        password: 'a-brand-new-password',
      });
      expect(typeof answered.message).toBe('string');
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

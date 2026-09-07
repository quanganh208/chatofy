import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import {
  MailBudgetClass,
  MailPurpose,
} from '../mail/interfaces/mail-sender.interface';
import { RegistrationService } from './registration.service';
import type { PendingRegistration, PurposeTokenService } from './purpose-token';
import type { AuthMailer } from './auth-mailer';
import type { PasswordHasher } from './password-hasher';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import { UserAlreadyExistsError } from '../users/interfaces/user-repository.interface';
import {
  mockUsers,
  realHasher,
  realMailer,
  realTokens,
  record,
  RecordingMailSender,
  settle,
} from './auth-flow.harness';

describe('RegistrationService', () => {
  let users: Mocked<UserRepository>;
  let mail: RecordingMailSender;
  let mailer: AuthMailer;
  let hasher: PasswordHasher;
  let tokens: PurposeTokenService;
  let service: RegistrationService;

  beforeEach(() => {
    users = mockUsers();
    mail = new RecordingMailSender();
    mailer = realMailer(mail);
    hasher = realHasher();
    tokens = realTokens();
    service = new RegistrationService(users, hasher, mailer, tokens);
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
        locale: 'en',
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
        locale: 'en',
      });

      users.findByEmail.mockResolvedValue(record());
      const taken = await service.register({
        email: 'taken@b.com',
        password: 'a-long-enough-password',
        name: 'A',
        locale: 'en',
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
      // Spied on the collaborator rather than through a cast into the
      // service's privates: hashing is now its own seam, so the assertion reads
      // the same call the flow actually makes.
      const hashSpy = vi.spyOn(hasher, 'hash');

      await service.register({
        email: 'taken@b.com',
        password: 'a-long-enough-password',
        name: 'A',
        locale: 'en',
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
        locale: 'en',
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
        locale: 'en',
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
      vi.spyOn(mail, 'send').mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const answered = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
        locale: 'en',
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
        locale: 'en',
      });
      await settle();

      expect(JSON.stringify(mail.sent[0])).not.toContain('evil.tld');
      // The interface has no field for free-form text at all — this holds by
      // construction, and this assertion is what notices if one is ever added.
      // `locale` is on the list deliberately: it is one of two enum values narrowed
      // at the DTO boundary, not text, and it reaches no header and no body — the
      // senders use it to CHOOSE a fixed template, never to compose one.
      expect(Object.keys(mail.sent[0]!).sort()).toEqual([
        'budgetClass',
        'link',
        'locale',
        'purpose',
        'to',
      ]);
    });

    it('still answers when the mail cannot be sent', async () => {
      // The HTTP answer must not vary with whether the mail got out — that would
      // report which branch ran.
      users.findByEmail.mockResolvedValue(null);
      vi.spyOn(mail, 'send').mockRejectedValue(new Error('smtp is down'));

      const answered = await service.register({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
        locale: 'en',
      });
      expect(typeof answered.message).toBe('string');
      await settle();
    });
  });

  describe('verifyEmail', () => {
    const pendingToken = (over: Partial<PendingRegistration> = {}) =>
      tokens.issueRegistration({
        email: 'a@b.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
        name: 'A',
        locale: 'en',
        ...over,
      });

    it('creates the account the link describes', async () => {
      users.create.mockResolvedValue(record());
      const result = await service.verifyEmail({ token: await pendingToken() });

      expect(users.create.mock.calls[0]?.[0]).toEqual({
        email: 'a@b.com',
        // From the token, because there was no row to store it on when the person
        // chose it — the row is what this call creates.
        locale: 'en',
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
      // The exact key set, not "has no token": a body that grew a session field
      // would pass a negative assertion for every name nobody thought to list.
      expect(Object.keys(result).sort()).toEqual(['code', 'message']);
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
    it('registers the same person whatever case they type', async () => {
      users.findByEmail.mockResolvedValue(null);
      await service.register({
        email: '  Alice@Corp.com ',
        password: 'a-long-enough-password',
        name: 'A',
        locale: 'en',
      });
      // The folded address is what the existence check asks about, and what the
      // verification link is later minted for. `auth.service.spec.ts` proves
      // the other half — that sign-in folds it the same way — since a fold applied
      // in only one of the two is the trap this exists to avoid.
      expect(users.findByEmail.mock.calls[0]?.[0]).toBe('alice@corp.com');
    });
  });
});

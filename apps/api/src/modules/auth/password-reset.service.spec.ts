import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import {
  MailBudgetClass,
  MailPurpose,
} from '../mail/interfaces/mail-sender.interface';
import { PasswordResetService } from './password-reset.service';
import { SessionTerminator } from './session-terminator';
import type { PurposeTokenService } from './purpose-token';
import type { AuthMailer } from './auth-mailer';
import type { PasswordHasher } from './password-hasher';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import {
  mockUsers,
  realHasher,
  realMailer,
  realTokens,
  record,
  RecordingMailSender,
  SECRET,
  settle,
} from './auth-flow.harness';

describe('PasswordResetService', () => {
  let users: jest.Mocked<UserRepository>;
  let mail: RecordingMailSender;
  let mailer: AuthMailer;
  let hasher: PasswordHasher;
  let tokens: PurposeTokenService;
  let terminator: SessionTerminator;
  let service: PasswordResetService;

  beforeEach(() => {
    users = mockUsers();
    mail = new RecordingMailSender();
    mailer = realMailer(mail);
    hasher = realHasher();
    tokens = realTokens();
    terminator = new SessionTerminator();
    service = new PasswordResetService(
      users,
      hasher,
      mailer,
      tokens,
      terminator,
    );
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
      jest.spyOn(hasher, 'hash').mockImplementation(async () => {
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
});

import { LOCALES } from '@chatofy/i18n';
import {
  forgotPasswordRequestSchema,
  registerRequestSchema,
  updateMeRequestSchema,
} from '@chatofy/types';
import {
  buildMailContent,
  MailPurpose,
} from '../mail/interfaces/mail-sender.interface';
import { PasswordResetService } from './password-reset.service';
import { SessionTerminator } from './session-terminator';
import type { AuthMailer } from './auth-mailer';
import type { PasswordHasher } from './password-hasher';
import type { PurposeTokenService } from './purpose-token';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import {
  mockUsers,
  realHasher,
  realMailer,
  realTokens,
  record,
  RecordingMailSender,
  settle,
} from './auth-flow.harness';

/**
 * Mail follows the RECIPIENT's language — and the one exception is a security
 * boundary, not a shortcut.
 *
 * Three of the four purposes read `User.locale` off a row this codebase already has
 * in hand. `NoAccountNotice` cannot: there is no row, which is what the notice is
 * about. It takes the requesting locale instead, and it must do so
 * **unconditionally**.
 *
 * That is the whole risk this file exists for. If the no-account branch resolved a
 * locale by looking anything up, a request for a real address would use the stored
 * preference while one for an unknown address fell back to a default — and the
 * difference is visible to whoever receives the mail. `forgotPassword` answers both
 * cases identically in status, body and response time precisely so that no signal
 * about account existence escapes; a language difference would put one back.
 */
describe('mail language', () => {
  /**
   * The request locale is attacker-controlled, and both routes that take it answer
   * identically for any address. A schema that THREW on `locale=xx` would answer one
   * request 400 and another 202 — a difference anyone can produce and read.
   */
  describe('an unsupported request locale', () => {
    // `catch` rather than `default`, which is what makes the wrong-TYPE case pass:
    // `default` only fills an absent value.
    const REFUSED: unknown[] = ['xx', 42, undefined];

    it.each(REFUSED)('coerces %s to the default on register', (locale) => {
      const parsed = registerRequestSchema.safeParse({
        email: 'a@b.com',
        password: 'a-long-enough-password',
        name: 'A',
        locale,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.locale).toBe('en');
    });

    it.each(REFUSED)(
      'coerces %s to the default on forgot-password too',
      (locale) => {
        const parsed = forgotPasswordRequestSchema.safeParse({
          email: 'a@b.com',
          locale,
        });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.locale).toBe('en');
      },
    );

    it('is REFUSED on the authenticated settings route', () => {
      // Different rule, deliberately: this one is called by someone changing their
      // own setting, so a 400 on nonsense tells the caller something true and leaks
      // nothing about anyone else.
      expect(updateMeRequestSchema.safeParse({ locale: 'xx' }).success).toBe(
        false,
      );
    });
  });

  describe('templates', () => {
    it.each(Object.values(MailPurpose))(
      '%s has real copy in every locale',
      (purpose) => {
        const rendered = LOCALES.map((locale) =>
          buildMailContent(
            purpose,
            'https://app.example.com/x?token=abc',
            locale,
          ),
        );

        for (const { subject, text } of rendered) {
          expect(subject.length).toBeGreaterThan(0);
          // The link is the only caller-controlled thing that reaches a body, and
          // every template must actually carry it — a translation that dropped it
          // sends a mail with no way to act on it.
          expect(text).toContain('https://app.example.com/x?token=abc');
        }

        // Distinct per locale. Equal strings would mean one locale silently fell
        // through to the other, which is what a `Record` keyed only by purpose used
        // to guarantee and what this replaced.
        const subjects = new Set(rendered.map((r) => r.subject));
        expect(subjects.size).toBe(LOCALES.length);
      },
    );
  });

  describe('forgotPassword', () => {
    let users: jest.Mocked<UserRepository>;
    let mail: RecordingMailSender;
    let mailer: AuthMailer;
    let hasher: PasswordHasher;
    let tokens: PurposeTokenService;
    let service: PasswordResetService;

    beforeEach(() => {
      users = mockUsers();
      mail = new RecordingMailSender();
      mailer = realMailer(mail);
      hasher = realHasher();
      tokens = realTokens();
      service = new PasswordResetService(
        users,
        hasher,
        mailer,
        tokens,
        new SessionTerminator(),
      );
    });

    it("writes the reset mail in the ROW's language, not the request's", async () => {
      users.findCredentialsByEmail.mockResolvedValue({
        user: record({ locale: 'vi' }),
        passwordHash: '$argon2-a-hash',
        googleSub: null,
      });

      await service.forgotPassword({ email: 'a@b.com', locale: 'en' });
      await settle();

      // The mailbox owner is not necessarily the person who filled in the form.
      expect(mail.sent[0]?.purpose).toBe(MailPurpose.PasswordReset);
      expect(mail.sent[0]?.locale).toBe('vi');
    });

    it('writes the no-account notice in the REQUEST language, consulting no row', async () => {
      users.findCredentialsByEmail.mockResolvedValue(null);

      await service.forgotPassword({ email: 'nobody@b.com', locale: 'vi' });
      await settle();

      expect(mail.sent[0]?.purpose).toBe(MailPurpose.NoAccountNotice);
      expect(mail.sent[0]?.locale).toBe('vi');

      // The assertion that matters. Any second read here — of the row, of a
      // preference, of anything — is an enumeration oracle in a new form.
      // Through `.mock.calls` rather than by handing the method to `expect`, which
      // is the codebase's convention here — an unbound method passed anywhere is a
      // `this` waiting to be lost.
      expect(users.findById.mock.calls).toHaveLength(0);
      expect(users.findByEmail.mock.calls).toHaveLength(0);
      expect(users.findCredentialsById.mock.calls).toHaveLength(0);
    });

    it('does the same awaited work on both branches', async () => {
      const awaited = () =>
        (users.findCredentialsByEmail.mock.calls.length ?? 0) +
        users.findById.mock.calls.length +
        users.findByEmail.mock.calls.length +
        users.findCredentialsById.mock.calls.length +
        users.findByGoogleSub.mock.calls.length;

      users.findCredentialsByEmail.mockResolvedValue({
        user: record({ locale: 'vi' }),
        passwordHash: '$argon2-a-hash',
        googleSub: null,
      });
      await service.forgotPassword({ email: 'a@b.com', locale: 'en' });
      const found = awaited();

      jest.clearAllMocks();
      users.findCredentialsByEmail.mockResolvedValue(null);
      await service.forgotPassword({ email: 'nobody@b.com', locale: 'en' });
      const missing = awaited();

      // One lookup each, and the same one. An extra awaited read on either path runs
      // BEFORE the return — the detached mail send does not hide it — so it is a
      // measurable response-time difference between "this address has an account"
      // and "it does not".
      expect(found).toBe(1);
      expect(missing).toBe(1);
    });

    it.each(LOCALES)(
      'answers identically in %s whichever branch it takes',
      async (locale) => {
        users.findCredentialsByEmail.mockResolvedValue({
          user: record({ locale: 'vi' }),
          passwordHash: '$argon2-a-hash',
          googleSub: null,
        });
        const found = await service.forgotPassword({
          email: 'a@b.com',
          locale,
        });

        users.findCredentialsByEmail.mockResolvedValue(null);
        const missing = await service.forgotPassword({
          email: 'nobody@b.com',
          locale,
        });

        // The HTTP body is one constant and stays one. Localizing it would have to
        // key on the REQUEST locale; keying on the stored one rebuilds the oracle in
        // the response body, where it is even easier to read than in a mailbox.
        expect(found).toEqual(missing);
      },
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ConsoleMailSender } from './console-mail.sender';
import {
  buildMailContent,
  MailBudgetClass,
  MailPurpose,
} from '../interfaces/mail-sender.interface';

describe('ConsoleMailSender', () => {
  it('prints the given link verbatim, with no undefined origin', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sender = new ConsoleMailSender();
    const link = 'http://localhost:3001/verify-email?token=abc123';

    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.VerifyEmail,
      budgetClass: MailBudgetClass.Reserved,
      link,
      locale: 'en',
    });

    const printed = logSpy.mock.calls.flat().join('\n');
    expect(printed).toContain(link);
    expect(printed).not.toContain('undefined');
    logSpy.mockRestore();
  });

  it("prints the dispatch's own language, not a default", async () => {
    // The dev sender is where a locale bug is most likely to go unnoticed, because
    // it is the only sender anyone reads during development and it never touches
    // SMTP. If it printed English for a Vietnamese dispatch, every local test of the
    // feature would look correct.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sender = new ConsoleMailSender();

    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.VerifyEmail,
      budgetClass: MailBudgetClass.AttackerTriggerable,
      link: 'http://localhost:3001/verify-email?token=abc123',
      locale: 'vi',
    });

    const printed = logSpy.mock.calls.flat().join('\n');
    expect(printed).toContain(
      buildMailContent(
        MailPurpose.VerifyEmail,
        'http://localhost:3001/verify-email?token=abc123',
        'vi',
      ).subject,
    );
    expect(printed).not.toContain('Verify your email address');
    logSpy.mockRestore();
  });

  it('resolves without throwing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const sender = new ConsoleMailSender();
    await expect(
      sender.send({
        to: 'user@example.com',
        purpose: MailPurpose.PasswordReset,
        budgetClass: MailBudgetClass.Reserved,
        link: 'http://localhost:3001/reset-password?token=abc123',
        locale: 'en',
      }),
    ).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

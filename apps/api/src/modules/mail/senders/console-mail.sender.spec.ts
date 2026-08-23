import { ConsoleMailSender } from './console-mail.sender';
import {
  MailBudgetClass,
  MailPurpose,
} from '../interfaces/mail-sender.interface';

describe('ConsoleMailSender', () => {
  it('prints the given link verbatim, with no undefined origin', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const sender = new ConsoleMailSender();
    const link = 'http://localhost:3001/verify-email?token=abc123';

    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.VerifyEmail,
      budgetClass: MailBudgetClass.Reserved,
      link,
    });

    const printed = logSpy.mock.calls.flat().join('\n');
    expect(printed).toContain(link);
    expect(printed).not.toContain('undefined');
    logSpy.mockRestore();
  });

  it('resolves without throwing', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const sender = new ConsoleMailSender();
    await expect(
      sender.send({
        to: 'user@example.com',
        purpose: MailPurpose.PasswordReset,
        budgetClass: MailBudgetClass.Reserved,
        link: 'http://localhost:3001/reset-password?token=abc123',
      }),
    ).resolves.toBeUndefined();
    jest.restoreAllMocks();
  });
});

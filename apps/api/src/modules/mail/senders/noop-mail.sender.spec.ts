import { Logger } from '@nestjs/common';
import { NoopMailSender } from './noop-mail.sender';
import {
  MailBudgetClass,
  MailPurpose,
} from '../interfaces/mail-sender.interface';

describe('NoopMailSender', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rejects rather than reporting a delivery that never happened', async () => {
    // Resolving would tell GuardedMailSender the send succeeded, which records
    // the ten-minute per-recipient cooldown — locking a user who received
    // nothing out of retrying. That is the exact failure the
    // record-on-success-only rule exists to prevent, arriving from inside.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sender = new NoopMailSender();
    await expect(
      sender.send({
        to: 'user@example.com',
        purpose: MailPurpose.VerifyEmail,
        budgetClass: MailBudgetClass.Reserved,
        link: 'https://app.example.com/verify-email?token=abc123',
        locale: 'en',
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('logs a loud warning on every attempted send', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const sender = new NoopMailSender();
    await sender
      .send({
        to: 'user@example.com',
        purpose: MailPurpose.PasswordReset,
        budgetClass: MailBudgetClass.Reserved,
        link: 'https://app.example.com/reset-password?token=abc123',
        locale: 'en',
      })
      .catch(() => undefined);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

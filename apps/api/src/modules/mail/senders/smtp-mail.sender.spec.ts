const sendMail = jest.fn().mockResolvedValue(undefined);
const createTransport = jest.fn().mockReturnValue({ sendMail });

jest.mock('nodemailer', () => ({ createTransport }));

import { SmtpMailSender } from './smtp-mail.sender';
import {
  MailBudgetClass,
  MailPurpose,
} from '../interfaces/mail-sender.interface';

describe('SmtpMailSender', () => {
  beforeEach(() => {
    createTransport.mockClear();
    sendMail.mockClear();
  });

  it('authenticates against the given host/port/credentials over implicit TLS', () => {
    new SmtpMailSender({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'me@gmail.com',
      pass: 'app-password',
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: 'me@gmail.com', pass: 'app-password' },
      }),
    );
  });

  it('defaults `from` to SMTP_USER when MAIL_FROM is not set', async () => {
    const sender = new SmtpMailSender({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'me@gmail.com',
      pass: 'app-password',
    });
    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.VerifyEmail,
      budgetClass: MailBudgetClass.Reserved,
      link: 'https://app.example.com/verify-email?token=abc123',
      locale: 'en',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'me@gmail.com', to: 'user@example.com' }),
    );
  });

  it('uses MAIL_FROM as a display-name override when set', async () => {
    const sender = new SmtpMailSender({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'me@gmail.com',
      pass: 'app-password',
      from: '"Chatofy" <me@gmail.com>',
    });
    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.PasswordReset,
      budgetClass: MailBudgetClass.Reserved,
      link: 'https://app.example.com/reset-password?token=abc123',
      locale: 'en',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: '"Chatofy" <me@gmail.com>' }),
    );
  });

  it('sends the purpose-derived subject/text and nothing user-supplied beyond the link', async () => {
    const sender = new SmtpMailSender({
      host: 'smtp.gmail.com',
      port: 465,
      user: 'me@gmail.com',
      pass: 'app-password',
    });
    const link = 'https://app.example.com/verify-email?token=abc123';
    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.VerifyEmail,
      budgetClass: MailBudgetClass.Reserved,
      link,
      locale: 'en',
    });
    const calls = sendMail.mock.calls as unknown[][];
    const call = calls.at(0)?.at(0) as { subject: string; text: string };
    expect(call.subject).toBe('Verify your email address');
    expect(call.text).toContain(link);
  });
});

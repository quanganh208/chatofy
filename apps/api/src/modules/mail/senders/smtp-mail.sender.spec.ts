import { beforeEach, describe, expect, it, vi } from 'vitest';

// Built inside `vi.hoisted` because `vi.mock` is lifted above every `const` in
// the file: declared normally, both spies would still be in the temporal dead
// zone when the factory below runs.
const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue(undefined);
  return { sendMail, createTransport: vi.fn().mockReturnValue({ sendMail }) };
});

vi.mock('nodemailer', () => ({ createTransport }));

import { SmtpMailSender } from './smtp-mail.sender';
import {
  buildMailMessage,
  MailBudgetClass,
  MailPurpose,
} from '../interfaces/mail-sender.interface';

const WEB_BASE_URL = 'https://app.example.com';

describe('SmtpMailSender', () => {
  beforeEach(() => {
    createTransport.mockClear();
    sendMail.mockClear();
  });

  it('authenticates against the given host/port/credentials over implicit TLS', () => {
    new SmtpMailSender(
      {
        host: 'smtp.gmail.com',
        port: 465,
        user: 'me@gmail.com',
        pass: 'app-password',
      },
      WEB_BASE_URL,
    );
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
    const sender = new SmtpMailSender(
      {
        host: 'smtp.gmail.com',
        port: 465,
        user: 'me@gmail.com',
        pass: 'app-password',
      },
      WEB_BASE_URL,
    );
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
    const sender = new SmtpMailSender(
      {
        host: 'smtp.gmail.com',
        port: 465,
        user: 'me@gmail.com',
        pass: 'app-password',
        from: '"Chatofy" <me@gmail.com>',
      },
      WEB_BASE_URL,
    );
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
    const sender = new SmtpMailSender(
      {
        host: 'smtp.gmail.com',
        port: 465,
        user: 'me@gmail.com',
        pass: 'app-password',
      },
      WEB_BASE_URL,
    );
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

  it('sends the html part beside the text part, built from the same link', async () => {
    const sender = new SmtpMailSender(
      {
        host: 'smtp.gmail.com',
        port: 465,
        user: 'me@gmail.com',
        pass: 'app-password',
      },
      WEB_BASE_URL,
    );
    const link = 'https://app.example.com/reset-password?token=abc123';
    await sender.send({
      to: 'user@example.com',
      purpose: MailPurpose.PasswordReset,
      budgetClass: MailBudgetClass.Reserved,
      link,
      locale: 'vi',
    });
    const calls = sendMail.mock.calls as unknown[][];
    const call = calls.at(0)?.at(0) as Record<string, unknown>;
    const expected = buildMailMessage(
      MailPurpose.PasswordReset,
      link,
      'vi',
      WEB_BASE_URL,
    );
    expect(Object.keys(call).sort()).toEqual(
      ['from', 'html', 'subject', 'text', 'to'].sort(),
    );
    expect(call.text).toBe(expected.text);
    expect(call.html).toBe(expected.html);
    expect(call.html).toContain(
      'src="https://app.example.com/email/chatofy-mark@2x.png"',
    );
  });
});

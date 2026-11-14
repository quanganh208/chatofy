import { htmlLang, LOCALES } from '@chatofy/i18n';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../branded-mail-layout';
import {
  buildMailContent,
  buildMailMessage,
  MailPurpose,
} from './mail-sender.interface';

const LINK = 'https://app.example.com/x?token=abc';
const WEB = 'https://chatofy.example.com';

/**
 * The plain-text part exactly as it was before the HTML part existed, captured
 * from the previous implementation. Byte-for-byte: a client that shows only the
 * text part must not notice the redesign.
 */
const TEXT_BEFORE_HTML: Record<string, { subject: string; text: string }> = {
  'verify-email/en': {
    subject: 'Verify your email address',
    text: 'Welcome to Chatofy! Confirm this address to finish creating your account:\n\nhttps://app.example.com/x?token=abc\n\nThis link expires in 24 hours. If you did not request this, you can ignore this email.',
  },
  'verify-email/vi': {
    subject: 'Xác minh địa chỉ email của bạn',
    text: 'Chào mừng bạn đến với Chatofy! Xác nhận địa chỉ này để hoàn tất việc tạo tài khoản:\n\nhttps://app.example.com/x?token=abc\n\nLiên kết này hết hạn sau 24 giờ. Nếu bạn không yêu cầu, cứ bỏ qua email này.',
  },
  'verify-email/zh': {
    subject: '验证你的邮箱地址',
    text: '欢迎使用 Chatofy！请确认此邮箱地址，完成账户注册：\n\nhttps://app.example.com/x?token=abc\n\n此链接将在 24 小时后失效。如果这不是你本人的操作，请忽略本邮件。',
  },
  'account-exists-notice/en': {
    subject: 'You already have a Chatofy account',
    text: 'An account already exists for this email address. Sign in, or if you forgot your password, reset it here:\n\nhttps://app.example.com/x?token=abc\n\nIf you did not expect this email, you can ignore it.',
  },
  'account-exists-notice/vi': {
    subject: 'Bạn đã có tài khoản Chatofy',
    text: 'Địa chỉ email này đã có một tài khoản. Bạn đăng nhập bình thường, hoặc nếu quên mật khẩu thì đặt lại tại đây:\n\nhttps://app.example.com/x?token=abc\n\nNếu bạn không chờ email này, cứ bỏ qua nó.',
  },
  'account-exists-notice/zh': {
    subject: '你已经有 Chatofy 账户了',
    text: '此邮箱地址已经注册过账户。请直接登录；如果忘记了密码，可以在这里重置：\n\nhttps://app.example.com/x?token=abc\n\n如果你并未预料到这封邮件，忽略即可。',
  },
  'no-account-notice/en': {
    subject: 'No Chatofy account for this address',
    text: 'Someone asked to reset a Chatofy password for this email address, but no account uses it. If that was you, you may have signed up with a different address — or you can create an account here:\n\nhttps://app.example.com/x?token=abc\n\nIf it was not you, you can ignore this email. Nothing has changed.',
  },
  'no-account-notice/vi': {
    subject: 'Không có tài khoản Chatofy cho địa chỉ này',
    text: 'Có người vừa yêu cầu đặt lại mật khẩu Chatofy cho địa chỉ email này, nhưng không tài khoản nào đang dùng nó. Nếu đó là bạn, có thể bạn đã đăng ký bằng một địa chỉ khác — hoặc bạn tạo tài khoản tại đây:\n\nhttps://app.example.com/x?token=abc\n\nNếu không phải bạn, cứ bỏ qua email này. Không có gì thay đổi cả.',
  },
  'no-account-notice/zh': {
    subject: '此邮箱地址没有 Chatofy 账户',
    text: '有人请求为此邮箱地址重置 Chatofy 密码，但没有任何账户使用它。如果是你本人，你可能是用其他邮箱地址注册的——你也可以在这里创建账户：\n\nhttps://app.example.com/x?token=abc\n\n如果不是你本人的操作，请忽略本邮件。你的账户信息不会有任何变化。',
  },
  'password-reset/en': {
    subject: 'Reset your Chatofy password',
    text: 'Use this link to choose a new password:\n\nhttps://app.example.com/x?token=abc\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.',
  },
  'password-reset/vi': {
    subject: 'Đặt lại mật khẩu Chatofy của bạn',
    text: 'Dùng liên kết này để chọn mật khẩu mới:\n\nhttps://app.example.com/x?token=abc\n\nLiên kết hết hạn sau 30 phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, cứ bỏ qua email này.',
  },
  'password-reset/zh': {
    subject: '重置你的 Chatofy 密码',
    text: '请使用此链接设置新密码：\n\nhttps://app.example.com/x?token=abc\n\n此链接将在 30 分钟后失效，且只能使用一次。如果这不是你本人的操作，请忽略本邮件。',
  },
};

describe('buildMailMessage', () => {
  const combos = Object.values(MailPurpose).flatMap((purpose) =>
    LOCALES.map((locale) => [purpose, locale] as const),
  );

  it('covers every purpose in every locale', () => {
    expect(combos).toHaveLength(Object.keys(TEXT_BEFORE_HTML).length);
  });

  it.each(combos)(
    '%s/%s has a subject, the unchanged text, and an html part',
    (purpose, locale) => {
      const message = buildMailMessage(purpose, LINK, locale, WEB);
      expect(TEXT_BEFORE_HTML[`${purpose}/${locale}`]).toEqual({
        subject: message.subject,
        text: message.text,
      });
      expect(buildMailContent(purpose, LINK, locale)).toEqual({
        subject: message.subject,
        text: message.text,
      });
      expect(message.html).toMatch(/^<!doctype html>/);
      expect(message.html).toContain(`lang="${htmlLang(locale)}"`);
      // Button, fallback text and its href: the link and nothing in its place.
      expect(message.html.split(`href="${LINK}"`)).toHaveLength(3);
      expect(message.html).toContain(`>${LINK}</a>`);
    },
  );

  it.each(combos)(
    '%s/%s ends the html intro with a full stop where the text part has a colon',
    (purpose, locale) => {
      const { text, html } = buildMailMessage(purpose, LINK, locale, WEB);
      const [intro = ''] = text.split('\n\n');
      // Chinese punctuates full-width: `：` in the text part, `。` in the html.
      const fullWidth = locale === 'zh';
      expect(intro).toMatch(fullWidth ? /：$/ : /:$/);
      const sentence = escapeHtml(
        `${intro.slice(0, -1)}${fullWidth ? '。' : '.'}`,
      );
      expect(html).toContain(`>${sentence}</p>`);
      expect(html).not.toContain(escapeHtml(intro));
    },
  );

  it('loads the logo from the configured web origin, not from the link', () => {
    const { html } = buildMailMessage(
      MailPurpose.PasswordReset,
      'chatofy://reset-password?token=abc',
      'en',
      WEB,
    );
    expect(html).toContain(
      'src="https://chatofy.example.com/email/chatofy-mark@2x.png"',
    );
    expect(html).not.toContain('src="chatofy:');
  });

  it('escapes a hostile link everywhere it appears', () => {
    const hostile = 'https://x/?a="><script>alert(1)</script>&b=\'';
    const { html, text } = buildMailMessage(
      MailPurpose.VerifyEmail,
      hostile,
      'en',
      WEB,
    );
    // The text part is not HTML; it carries the link as given.
    expect(text).toContain(hostile);
    expect(html).not.toContain('<script');
    // No markup of its own: the same mail with a harmless link has exactly as
    // many tags and quotes, so the hostile one opened nothing.
    const benign = buildMailMessage(MailPurpose.VerifyEmail, LINK, 'en', WEB);
    for (const char of ['<', '>', '"']) {
      expect(html.split(char).length).toBe(benign.html.split(char).length);
    }
    const escaped =
      'https://x/?a=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;b=&#39;';
    expect(html.split(`href="${escaped}"`)).toHaveLength(3);
    expect(html).toContain(`>${escaped}</a>`);
  });
});

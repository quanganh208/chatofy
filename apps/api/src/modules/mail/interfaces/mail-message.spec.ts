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
 * The plain-text part of every mail, byte-for-byte: intro, link, outro, and
 * nothing else. The HTML part must not change what a client that shows only the
 * text part reads; a copy edit updates these literals along with the table.
 */
const TEXT_BEFORE_HTML: Record<string, { subject: string; text: string }> = {
  'verify-email/en': {
    subject: 'Verify your email for Chatofy',
    text: 'Welcome to Chatofy! Verify this email to finish creating your account:\n\nhttps://app.example.com/x?token=abc\n\nThis link expires in 24 hours. Didn’t sign up? You can ignore this email.',
  },
  'verify-email/vi': {
    subject: 'Xác minh email cho tài khoản Chatofy',
    text: 'Chào mừng bạn đến với Chatofy! Xác minh email này là tạo xong tài khoản:\n\nhttps://app.example.com/x?token=abc\n\nLiên kết có hiệu lực trong 24 giờ. Nếu bạn không đăng ký, cứ bỏ qua email này.',
  },
  'verify-email/zh': {
    subject: '验证邮箱，完成 Chatofy 注册',
    text: '欢迎来到 Chatofy！验证这个邮箱，就能完成注册：\n\nhttps://app.example.com/x?token=abc\n\n链接 24 小时内有效。如果不是你注册的，忽略这封邮件就好。',
  },
  'account-exists-notice/en': {
    subject: 'You already have a Chatofy account',
    text: 'This email already has a Chatofy account, so just sign in. Forgot your password? Reset it here:\n\nhttps://app.example.com/x?token=abc\n\nDidn’t expect this email? You can ignore it.',
  },
  'account-exists-notice/vi': {
    subject: 'Bạn đã có tài khoản Chatofy rồi',
    text: 'Email này đã có tài khoản Chatofy, bạn cứ đăng nhập như thường. Nếu quên mật khẩu, đặt lại tại đây:\n\nhttps://app.example.com/x?token=abc\n\nNếu email này đến bất ngờ, bạn cứ bỏ qua.',
  },
  'account-exists-notice/zh': {
    subject: '你已经有 Chatofy 账号了',
    text: '这个邮箱已经注册过 Chatofy，直接登录就行。忘记密码的话，可以在这里重置：\n\nhttps://app.example.com/x?token=abc\n\n没想到会收到这封邮件？忽略就好。',
  },
  'no-account-notice/en': {
    subject: 'No Chatofy account uses this email',
    text: 'Someone asked to reset a Chatofy password for this email, but no account uses it. If that was you, you may have signed up with another email. Or create an account here:\n\nhttps://app.example.com/x?token=abc\n\nWasn’t you? You can ignore this email. Nothing has changed.',
  },
  'no-account-notice/vi': {
    subject: 'Chưa có tài khoản Chatofy nào dùng email này',
    text: 'Có người vừa yêu cầu đặt lại mật khẩu Chatofy bằng email này, nhưng chưa có tài khoản nào dùng email đó. Nếu đó là bạn, có thể bạn đã đăng ký bằng email khác. Hoặc tạo tài khoản mới tại đây:\n\nhttps://app.example.com/x?token=abc\n\nNếu không phải bạn, cứ bỏ qua email này. Mọi thứ vẫn như cũ.',
  },
  'no-account-notice/zh': {
    subject: '这个邮箱还没有 Chatofy 账号',
    text: '有人想用这个邮箱重置 Chatofy 密码，但它还没有注册账号。如果是你，可能当初注册用的是别的邮箱；也可以在这里注册：\n\nhttps://app.example.com/x?token=abc\n\n如果不是你，忽略这封邮件就好，一切照旧。',
  },
  'password-reset/en': {
    subject: 'Reset your Chatofy password',
    text: 'Use this link to choose a new password:\n\nhttps://app.example.com/x?token=abc\n\nThis link expires in 30 minutes and works only once. Didn’t ask for this? You can ignore this email.',
  },
  'password-reset/vi': {
    subject: 'Đặt lại mật khẩu Chatofy',
    text: 'Dùng liên kết này để đặt mật khẩu mới:\n\nhttps://app.example.com/x?token=abc\n\nLiên kết có hiệu lực trong 30 phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, cứ bỏ qua email này.',
  },
  'password-reset/zh': {
    subject: '重置你的 Chatofy 密码',
    text: '用这个链接设置新密码：\n\nhttps://app.example.com/x?token=abc\n\n链接 30 分钟内有效，只能用一次。如果不是你本人操作，忽略这封邮件就好。',
  },
  'team-invite/en': {
    subject: 'You’re invited to a team on Chatofy',
    text: 'Someone invited this email to join their team on Chatofy. Sign in with this email to see the invite:\n\nhttps://app.example.com/x?token=abc\n\nThis link expires in 7 days and works only once. Not expecting an invite? You can ignore this email.',
  },
  'team-invite/vi': {
    subject: 'Bạn có lời mời vào nhóm trên Chatofy',
    text: 'Có người mời email này vào nhóm của họ trên Chatofy. Đăng nhập bằng email này để xem lời mời:\n\nhttps://app.example.com/x?token=abc\n\nLiên kết có hiệu lực trong 7 ngày và chỉ dùng được một lần. Nếu bạn không chờ lời mời nào, cứ bỏ qua email này.',
  },
  'team-invite/zh': {
    subject: '有人邀请你在 Chatofy 上加入团队',
    text: '有人邀请这个邮箱加入他们在 Chatofy 上的团队。用这个邮箱登录，就能看到邀请：\n\nhttps://app.example.com/x?token=abc\n\n链接 7 天内有效，只能用一次。如果你没在等这个邀请，忽略这封邮件就好。',
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

  // The footer names the thing the bodies name: the reader's email, not an
  // "address", which reads as a postal one in all three languages.
  it.each([
    [
      'en',
      'You’re getting this email because someone used this email on Chatofy.',
    ],
    ['vi', 'Bạn nhận được thư này vì có người đã dùng email này trên Chatofy.'],
    ['zh', '你收到这封邮件，是因为有人在 Chatofy 上用了这个邮箱。'],
  ] as const)('%s footer says why the mail came', (locale, line) => {
    const { html } = buildMailMessage(
      MailPurpose.VerifyEmail,
      LINK,
      locale,
      WEB,
    );
    expect(html).toContain(escapeHtml(line));
  });

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

import { DEFAULT_LOCALE, htmlLang, type Locale } from '@chatofy/i18n';
import { brandedMailLogoUrl, renderBrandedMail } from '../branded-mail-layout';

/**
 * DI injection token — use Symbol to avoid string collision.
 *
 * MailModule exports ONLY this token, never a concrete sender class or a
 * separate dispatch service. The cooldown and the send budget live inside
 * the bound instance (GuardedMailSender), so a caller cannot reach a
 * "cheaper" seam that skips them — see mail.module.ts.
 */
export const MAIL_SENDER = Symbol('MAIL_SENDER');

/**
 * Every kind of mail the product sends. Each purpose maps to a fixed
 * subject/body constant in MAIL_CONTENT below — adding a new purpose means
 * adding its content there before anything can dispatch it. This is what
 * keeps user-supplied text out of a mail body: there is no code path that
 * builds a subject or body from a request field.
 */
export enum MailPurpose {
  VerifyEmail = 'verify-email',
  AccountExistsNotice = 'account-exists-notice',
  NoAccountNotice = 'no-account-notice',
  PasswordReset = 'password-reset',
  /**
   * An authenticated user names an arbitrary recipient, so the mail is
   * AttackerTriggerable. The copy is static and never carries a team name or
   * user text: a team named like a security notice would be phishing from our
   * own domain.
   */
  TeamInvite = 'team-invite',
}

/**
 * Which rolling-24h budget a send draws from — enforced by GuardedMailSender,
 * not by this module. The caller states the class explicitly per send; it is
 * NOT derived from `purpose` here, because which real-world action counts as
 * attacker-triggerable is a fact about the HTTP route calling this seam, not
 * about the mail's content. See guarded-mail.sender.ts for the ceilings.
 *
 * AttackerTriggerable — the caller of the HTTP route names the recipient and
 * needs no proof they control that mailbox, and NO ROW HAS TO EXIST for the
 * send to happen. An address-rotation attacker can trigger these at will, so
 * they share one ceiling and cannot reach past it.
 *
 * Registration's verification mail belongs here, which is worth stating because
 * it is the classification most likely to be "corrected" back. It is sent on
 * `POST /auth/register` for a FRESH address — the caller invented that address
 * and no row exists for it — so it is exactly as attacker-triggerable as the
 * already-registered notice beside it. Put it in Reserved and the rotation
 * attack drains the reserved ceiling through registration, which is the outcome
 * the tiering exists to prevent.
 *
 * Reserved — mail sent only to a row that ALREADY EXISTS, which an attacker
 * therefore cannot conjure by naming addresses: password reset, and nothing
 * else today. This is the only mail a ceiling can genuinely protect, and
 * protecting it is what keeps account recovery working while registration is
 * under attack.
 *
 * ## The residual oracle in this tier, recorded so it is not re-found as new
 *
 * Because `Reserved` is reachable ONLY by naming an address that has an account,
 * its exhaustion is one bit of information about account existence. An attacker
 * holding enough accounts of their own can fill the tier to one below its
 * ceiling, request a reset for a target, then check their own mailbox: no mail
 * means the target's reset consumed the last slot, so the target has an account.
 *
 * That is one bit per rolling 24 hours, and it costs them a number of real,
 * verified accounts equal to the ceiling minus one — each of which now requires
 * control of a distinct mailbox, because registration is verified. It is
 * inherent to ANY budget keyed on row existence, which is what the tiering is;
 * removing it would mean removing the protection. The reclassification above
 * makes it harder, not easier, by raising what the attacker must first spend.
 *
 * Do not "fix" this by failing open when the tier is exhausted — that trades a
 * one-bit-per-day leak for the product-wide account-recovery outage the tier
 * exists to prevent.
 */
export enum MailBudgetClass {
  AttackerTriggerable = 'attacker-triggerable',
  Reserved = 'reserved',
}

/**
 * One outbound mail. `to` is the only piece of caller-controlled data that
 * reaches a header (it has to — it IS the recipient); `link` is the only
 * caller-controlled data that reaches the body, and it must already be a
 * complete, safe URL (built from WEB_BASE_URL, never from a request header —
 * see WEB_BASE_URL in env.schema.ts). Nothing else about the dispatch —
 * no name, no free-form text — is accepted, by construction: this
 * interface has no field for it.
 */
export interface MailDispatch {
  readonly to: string;
  readonly purpose: MailPurpose;
  readonly budgetClass: MailBudgetClass;
  readonly link: string;
  /**
   * The language this mail is written in — the RECIPIENT's, not the requester's.
   *
   * Mail is composed when no browser is present to ask, which is the whole reason
   * `User.locale` exists. Three of the four purposes read it off the row; the fourth,
   * `NoAccountNotice`, has no row by construction and takes the requesting locale
   * instead. See `password-reset.service.ts` for why that one must NOT branch on a
   * lookup.
   */
  readonly locale: Locale;
}

/**
 * Provider-agnostic mail transport. Implementations: SmtpMailSender (Gmail),
 * ConsoleMailSender (dev/test), NoopMailSender (fail-closed fallback). All
 * three are wrapped by GuardedMailSender before binding to MAIL_SENDER, so
 * every caller of this interface already has the cooldown and budget applied
 * — there is nothing to opt into and nothing to bypass.
 */
export interface MailSender {
  send(dispatch: MailDispatch): Promise<void>;
}

/**
 * The fixed copy of one mail in one language. Nothing in it is a template: the
 * link is placed between `intro` and `outro` by the builders below, and it is
 * the only value that does not come from this table.
 *
 * `heading` and `action` exist only in the HTML part — the page title and the
 * button label. The plain-text part is `intro`, the link, and `outro`, exactly
 * as it was before there was an HTML part.
 */
interface MailCopy {
  readonly subject: string;
  readonly heading: string;
  /** Ends in a colon, because in the text part the link follows it. */
  readonly intro: string;
  readonly action: string;
  readonly outro: string;
}

/**
 * Fixed subject/body per purpose, per language. Body is this constant plus the link —
 * nothing else, in any language.
 *
 * Keyed purpose-first and locale-second so a new purpose cannot be added in one
 * language only: the type demands every locale, and `tsc` names the missing one. That
 * is the same parity-by-compiler `@chatofy/i18n` uses across its dictionaries, applied to the
 * copy that does not belong in a UI dictionary — nothing here is ever rendered in a
 * browser, and putting it in the web app's dictionary would put mail copy on a surface
 * that does not send mail.
 *
 * The Vietnamese addresses the reader as "bạn", the register decided for the product
 * and recorded in `docs/design-guidelines.md` § Copy register. It is written against
 * that rule rather than translated word-for-word from the English. The Chinese
 * addresses the reader as "你", with full-width punctuation, written the same way.
 */
const MAIL_CONTENT: Record<MailPurpose, Record<Locale, MailCopy>> = {
  [MailPurpose.VerifyEmail]: {
    en: {
      subject: 'Verify your email for Chatofy',
      heading: 'Verify your email',
      intro:
        'Welcome to Chatofy! Verify this email to finish creating your account:',
      action: 'Verify email',
      outro:
        'This link expires in 24 hours. Didn’t sign up? You can ignore this email.',
    },
    vi: {
      subject: 'Xác minh email cho tài khoản Chatofy',
      heading: 'Xác minh email của bạn',
      intro:
        'Chào mừng bạn đến với Chatofy! Xác minh email này là tạo xong tài khoản:',
      action: 'Xác minh email',
      outro:
        'Liên kết có hiệu lực trong 24 giờ. Nếu bạn không đăng ký, cứ bỏ qua email này.',
    },
    zh: {
      subject: '验证邮箱，完成 Chatofy 注册',
      heading: '验证你的邮箱',
      intro: '欢迎来到 Chatofy！验证这个邮箱，就能完成注册：',
      action: '验证邮箱',
      outro: '链接 24 小时内有效。如果不是你注册的，忽略这封邮件就好。',
    },
  },
  [MailPurpose.AccountExistsNotice]: {
    en: {
      subject: 'You already have a Chatofy account',
      heading: 'You already have an account',
      intro:
        'This email already has a Chatofy account, so just sign in. ' +
        'Forgot your password? Reset it here:',
      action: 'Reset password',
      outro: 'Didn’t expect this email? You can ignore it.',
    },
    vi: {
      subject: 'Bạn đã có tài khoản Chatofy rồi',
      heading: 'Bạn đã có tài khoản rồi',
      intro:
        'Email này đã có tài khoản Chatofy, bạn cứ đăng nhập như thường. ' +
        'Nếu quên mật khẩu, đặt lại tại đây:',
      action: 'Đặt lại mật khẩu',
      outro: 'Nếu email này đến bất ngờ, bạn cứ bỏ qua.',
    },
    zh: {
      subject: '你已经有 Chatofy 账号了',
      heading: '你已经有账号了',
      intro:
        '这个邮箱已经注册过 Chatofy，直接登录就行。忘记密码的话，可以在这里重置：',
      action: '重置密码',
      outro: '没想到会收到这封邮件？忽略就好。',
    },
  },
  [MailPurpose.NoAccountNotice]: {
    en: {
      subject: 'No Chatofy account uses this email',
      heading: 'No account uses this email',
      intro:
        'Someone asked to reset a Chatofy password for this email, but no account ' +
        'uses it. If that was you, you may have signed up with another email. ' +
        'Or create an account here:',
      action: 'Create account',
      outro: 'Wasn’t you? You can ignore this email. Nothing has changed.',
    },
    vi: {
      subject: 'Chưa có tài khoản Chatofy nào dùng email này',
      heading: 'Chưa có tài khoản nào dùng email này',
      intro:
        'Có người vừa yêu cầu đặt lại mật khẩu Chatofy bằng email này, nhưng chưa có ' +
        'tài khoản nào dùng email đó. Nếu đó là bạn, có thể bạn đã đăng ký bằng email ' +
        'khác. Hoặc tạo tài khoản mới tại đây:',
      action: 'Tạo tài khoản',
      outro: 'Nếu không phải bạn, cứ bỏ qua email này. Mọi thứ vẫn như cũ.',
    },
    zh: {
      subject: '这个邮箱还没有 Chatofy 账号',
      heading: '这个邮箱还没有账号',
      intro:
        '有人想用这个邮箱重置 Chatofy 密码，但它还没有注册账号。如果是你，' +
        '可能当初注册用的是别的邮箱；也可以在这里注册：',
      action: '注册账号',
      outro: '如果不是你，忽略这封邮件就好，一切照旧。',
    },
  },
  [MailPurpose.PasswordReset]: {
    en: {
      subject: 'Reset your Chatofy password',
      heading: 'Reset your password',
      intro: 'Use this link to choose a new password:',
      action: 'Set new password',
      outro:
        'This link expires in 30 minutes and works only once. Didn’t ask for this? You can ignore this email.',
    },
    vi: {
      subject: 'Đặt lại mật khẩu Chatofy',
      heading: 'Đặt lại mật khẩu',
      intro: 'Dùng liên kết này để đặt mật khẩu mới:',
      action: 'Đặt mật khẩu mới',
      outro:
        'Liên kết có hiệu lực trong 30 phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, cứ bỏ qua email này.',
    },
    zh: {
      subject: '重置你的 Chatofy 密码',
      heading: '重置密码',
      intro: '用这个链接设置新密码：',
      action: '设置新密码',
      outro:
        '链接 30 分钟内有效，只能用一次。如果不是你本人操作，忽略这封邮件就好。',
    },
  },
  [MailPurpose.TeamInvite]: {
    en: {
      subject: 'You’re invited to a team on Chatofy',
      heading: 'You’re invited to a team',
      intro:
        'Someone invited this email to join their team on Chatofy. Sign in with this email to see the invite:',
      action: 'View invite',
      outro:
        'This link expires in 7 days and works only once. Not expecting an invite? You can ignore this email.',
    },
    vi: {
      subject: 'Bạn có lời mời vào nhóm trên Chatofy',
      heading: 'Bạn có lời mời vào nhóm',
      intro:
        'Có người mời email này vào nhóm của họ trên Chatofy. Đăng nhập bằng email này để xem lời mời:',
      action: 'Xem lời mời',
      outro:
        'Liên kết có hiệu lực trong 7 ngày và chỉ dùng được một lần. Nếu bạn không chờ lời mời nào, cứ bỏ qua email này.',
    },
    zh: {
      subject: '有人邀请你加入 Chatofy 团队',
      heading: '有人邀请你加入团队',
      intro:
        '有人邀请这个邮箱加入他们在 Chatofy 上的团队。用这个邮箱登录，就能看到邀请：',
      action: '查看邀请',
      outro:
        '链接 7 天内有效，只能用一次。如果你没在等这个邀请，忽略这封邮件就好。',
    },
  },
};

interface MailChrome {
  readonly fallback: string;
  readonly footer: readonly [string, string];
}

/**
 * The lines every HTML mail shares, per language. Fixed text, like the table
 * above; the text part has no equivalent, because it has no button to fail and
 * no layout to sign off.
 */
const MAIL_CHROME: Record<Locale, MailChrome> = {
  en: {
    fallback: 'Button not working? Paste this link into your browser:',
    footer: [
      'Chatofy — real-time speech translation.',
      'You’re getting this email because someone used this address on Chatofy.',
    ],
  },
  vi: {
    fallback: 'Nút không bấm được? Dán liên kết này vào trình duyệt:',
    footer: [
      'Chatofy: dịch giọng nói theo thời gian thực.',
      'Bạn nhận email này vì có người đã dùng địa chỉ này trên Chatofy.',
    ],
  },
  zh: {
    fallback: '按钮点不开？把这个链接粘贴到浏览器里打开：',
    footer: [
      'Chatofy：实时语音翻译。',
      '你收到这封邮件，是因为有人在 Chatofy 上用了这个邮箱。',
    ],
  },
};

/** Builds the subject/body for a dispatch. The single place mail text is composed. */
export function buildMailContent(
  purpose: MailPurpose,
  link: string,
  locale: Locale = DEFAULT_LOCALE,
): { subject: string; text: string } {
  const { subject, intro, outro } = MAIL_CONTENT[purpose][locale];
  return { subject, text: `${intro}\n\n${link}\n\n${outro}` };
}

/**
 * The same mail with its HTML part: `buildMailContent`'s subject and text, plus
 * the branded layout around the same copy and the same link.
 *
 * `webBaseUrl` is where the logo image is fetched from, and it must be the
 * configured WEB_BASE_URL — never a request header, for the reason `AuthMailer.link`
 * gives, and never parsed out of the link: the link is the one value per send,
 * and the logo's home is a fact about the deployment. It is a separate parameter rather than
 * a field of MailDispatch for the same reason.
 */
export function buildMailMessage(
  purpose: MailPurpose,
  link: string,
  locale: Locale,
  webBaseUrl: string,
): { subject: string; text: string; html: string } {
  const copy = MAIL_CONTENT[purpose][locale];
  const chrome = MAIL_CHROME[locale];
  return {
    ...buildMailContent(purpose, link, locale),
    html: renderBrandedMail({
      lang: htmlLang(locale),
      title: copy.subject,
      heading: copy.heading,
      // In the text part a colon introduces the link on the next line; here a
      // button follows the paragraph instead, so the sentence ends. Chinese ends on
      // the full-width pair, `：` to `。`.
      intro: copy.intro.replace(/:$/, '.').replace(/：$/, '。'),
      action: copy.action,
      link,
      fallback: chrome.fallback,
      outro: copy.outro,
      footer: chrome.footer,
      logoUrl: brandedMailLogoUrl(webBaseUrl),
    }),
  };
}

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
      subject: 'Verify your email address',
      heading: 'Verify your email address',
      intro:
        'Welcome to Chatofy! Confirm this address to finish creating your account:',
      action: 'Verify email',
      outro:
        'This link expires in 24 hours. If you did not request this, you can ignore this email.',
    },
    vi: {
      subject: 'Xác minh địa chỉ email của bạn',
      heading: 'Xác minh địa chỉ email của bạn',
      intro:
        'Chào mừng bạn đến với Chatofy! Xác nhận địa chỉ này để hoàn tất việc tạo tài khoản:',
      action: 'Xác minh email',
      outro:
        'Liên kết này hết hạn sau 24 giờ. Nếu bạn không yêu cầu, cứ bỏ qua email này.',
    },
    zh: {
      subject: '验证你的邮箱地址',
      heading: '验证你的邮箱地址',
      intro: '欢迎使用 Chatofy！请确认此邮箱地址，完成账户注册：',
      action: '验证邮箱',
      outro: '此链接将在 24 小时后失效。如果这不是你本人的操作，请忽略本邮件。',
    },
  },
  [MailPurpose.AccountExistsNotice]: {
    en: {
      subject: 'You already have a Chatofy account',
      heading: 'You already have an account',
      intro:
        'An account already exists for this email address. Sign in, or if you ' +
        'forgot your password, reset it here:',
      action: 'Reset password',
      outro: 'If you did not expect this email, you can ignore it.',
    },
    vi: {
      subject: 'Bạn đã có tài khoản Chatofy',
      heading: 'Bạn đã có tài khoản',
      intro:
        'Địa chỉ email này đã có một tài khoản. Bạn đăng nhập bình thường, hoặc nếu ' +
        'quên mật khẩu thì đặt lại tại đây:',
      action: 'Đặt lại mật khẩu',
      outro: 'Nếu bạn không chờ email này, cứ bỏ qua nó.',
    },
    zh: {
      subject: '你已经有 Chatofy 账户了',
      heading: '你已经有账户了',
      intro:
        '此邮箱地址已经注册过账户。请直接登录；如果忘记了密码，可以在这里重置：',
      action: '重置密码',
      outro: '如果你并未预料到这封邮件，忽略即可。',
    },
  },
  [MailPurpose.NoAccountNotice]: {
    en: {
      subject: 'No Chatofy account for this address',
      heading: 'No account uses this address',
      intro:
        'Someone asked to reset a Chatofy password for this email address, but no ' +
        'account uses it. If that was you, you may have signed up with a different ' +
        'address — or you can create an account here:',
      action: 'Create an account',
      outro:
        'If it was not you, you can ignore this email. Nothing has changed.',
    },
    vi: {
      subject: 'Không có tài khoản Chatofy cho địa chỉ này',
      heading: 'Chưa có tài khoản nào dùng địa chỉ này',
      intro:
        'Có người vừa yêu cầu đặt lại mật khẩu Chatofy cho địa chỉ email này, nhưng ' +
        'không tài khoản nào đang dùng nó. Nếu đó là bạn, có thể bạn đã đăng ký bằng ' +
        'một địa chỉ khác — hoặc bạn tạo tài khoản tại đây:',
      action: 'Tạo tài khoản',
      outro:
        'Nếu không phải bạn, cứ bỏ qua email này. Không có gì thay đổi cả.',
    },
    zh: {
      subject: '此邮箱地址没有 Chatofy 账户',
      heading: '没有账户使用此邮箱地址',
      intro:
        '有人请求为此邮箱地址重置 Chatofy 密码，但没有任何账户使用它。如果是你本人，' +
        '你可能是用其他邮箱地址注册的——你也可以在这里创建账户：',
      action: '创建账户',
      outro: '如果不是你本人的操作，请忽略本邮件。你的账户信息不会有任何变化。',
    },
  },
  [MailPurpose.PasswordReset]: {
    en: {
      subject: 'Reset your Chatofy password',
      heading: 'Reset your password',
      intro: 'Use this link to choose a new password:',
      action: 'Choose a new password',
      outro:
        'This link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.',
    },
    vi: {
      subject: 'Đặt lại mật khẩu Chatofy của bạn',
      heading: 'Đặt lại mật khẩu của bạn',
      intro: 'Dùng liên kết này để chọn mật khẩu mới:',
      action: 'Chọn mật khẩu mới',
      outro:
        'Liên kết hết hạn sau 30 phút và chỉ dùng được một lần. Nếu bạn không yêu cầu, cứ bỏ qua email này.',
    },
    zh: {
      subject: '重置你的 Chatofy 密码',
      heading: '重置你的密码',
      intro: '请使用此链接设置新密码：',
      action: '设置新密码',
      outro:
        '此链接将在 30 分钟后失效，且只能使用一次。如果这不是你本人的操作，请忽略本邮件。',
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
      'You got this email because someone used this address on Chatofy.',
    ],
  },
  vi: {
    fallback: 'Nút không bấm được? Dán liên kết này vào trình duyệt của bạn:',
    footer: [
      'Chatofy — dịch giọng nói theo thời gian thực.',
      'Bạn nhận được email này vì có người đã dùng địa chỉ này trên Chatofy.',
    ],
  },
  zh: {
    fallback: '按钮无法点击？请将此链接粘贴到浏览器中打开：',
    footer: [
      'Chatofy——实时语音翻译。',
      '你收到这封邮件，是因为有人在 Chatofy 上使用了此邮箱地址。',
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

import {
  creditBalanceSchema,
  creditsFromSeconds,
  creditUsageListReadSchema,
  type CreditBalance,
  type CreditUsageEntry,
  type CreditUsageKind,
  type ServerEvent,
} from '@chatofy/types';
import type { RealtimeErrorCause } from '@chatofy/realtime-client';
import type { MessageKey } from '@chatofy/i18n';
import { getFreshAccessToken } from './access-token';
import { intlLocale, t } from './i18n';

/**
 * The extension's read of the account's AI credits, and the words for the
 * credit codes a capture can be sent.
 *
 * Words from `@chatofy/i18n`, in the browser's language (`./i18n.ts`). Buying is
 * never offered here — it happens on the web.
 */

/** Usage rows the popup lists. The popup is 600px tall and already scrolls. */
export const POPUP_USAGE_ROWS = 5;

/** What one load produced, including why part of it is missing. */
export interface CreditsResult {
  balance: CreditBalance | null;
  usage: CreditUsageEntry[];
  /** Set on any failure. Whatever did load is still returned. */
  message?: string;
}

type Read<T> = { ok: true; data: T } | { ok: false; message: string };

/** What to say when one of the two reads fails, by which read it was. */
interface ReadFailures {
  /** Takes `{status}`. */
  loadFailed: MessageKey;
  unreadable: MessageKey;
}

const BALANCE_FAILURES: ReadFailures = {
  loadFailed: 'extension.credits.loadFailed',
  unreadable: 'extension.credits.unreadable',
};

const USAGE_FAILURES: ReadFailures = {
  loadFailed: 'extension.credits.usageLoadFailed',
  unreadable: 'extension.credits.usageUnreadable',
};

/** One enveloped GET, parsed. Never throws. */
async function readEnveloped<T>(
  url: string,
  accessToken: string,
  parse: (data: unknown) => { success: true; data: T } | { success: false },
  failures: ReadFailures,
): Promise<Read<T>> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    return {
      ok: false,
      message: t('extension.error.unreachable', { origin: new URL(url).origin }),
    };
  }
  if (!res.ok) return { ok: false, message: t(failures.loadFailed, { status: res.status }) };
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  const parsed = parse(body?.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, message: t(failures.unreadable) };
}

/**
 * The balance and the newest usage rows, read together with one fresh token.
 *
 * Never throws: a network failure, an expired session or an unreadable answer
 * comes back as a message beside whatever half did load, so a usage page that
 * failed does not hide a balance that did not. Usage is read entry by entry, so
 * a usage kind a later API adds costs that row, not the list.
 */
export async function loadCredits(apiBaseUrl: string): Promise<CreditsResult> {
  const accessToken = await getFreshAccessToken(apiBaseUrl);
  if (accessToken === null) {
    return { balance: null, usage: [], message: t('extension.credits.signInToSee') };
  }

  const [balance, usage] = await Promise.all([
    readEnveloped(
      `${apiBaseUrl}/billing/me`,
      accessToken,
      (data) => creditBalanceSchema.safeParse(data),
      BALANCE_FAILURES,
    ),
    readEnveloped(
      `${apiBaseUrl}/billing/usage`,
      accessToken,
      (data) => creditUsageListReadSchema.safeParse(data),
      USAGE_FAILURES,
    ),
  ]);

  const result: CreditsResult = {
    balance: balance.ok ? balance.data : null,
    usage: usage.ok ? usage.data.entries.slice(0, POPUP_USAGE_ROWS) : [],
  };
  const message = !balance.ok ? balance.message : !usage.ok ? usage.message : undefined;
  return message === undefined ? result : { ...result, message };
}

const NUMBER = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 });

/** "1 credit", "2.5 credits"; the sign is dropped, a caller that shows one adds it. */
export function formatCredits(credits: number): string {
  const magnitude = Math.abs(credits);
  return magnitude === 1
    ? t('common.billing.creditAmountOne')
    : t('common.billing.creditAmount', { credits: NUMBER.format(magnitude) });
}

/** A usage row's amount with its direction: "−1.5 credits", "+600 credits". */
export function formatSignedCredits(credits: number): string {
  const sign = credits > 0 ? '+' : credits < 0 ? '−' : '';
  return `${sign}${formatCredits(credits)}`;
}

export const USAGE_KIND_LABEL: Record<CreditUsageKind, string> = {
  translate: t('common.billing.usageKind.translate'),
  minutes: t('common.billing.usageKind.minutes'),
  grant: t('common.billing.usageKind.grant'),
  refund: t('common.billing.usageKind.refund'),
  expire: t('common.billing.usageKind.expire'),
  void: t('common.billing.usageKind.void'),
};

/**
 * What a capture's leg has seen of its turns, read when a credit code arrives.
 * The session hands every server event to `observe` BEFORE it reports a server
 * error, so a refusal knows whether a turn had opened. The balance the error
 * carried arrives on `onError`'s cause itself.
 */
export class CreditContext {
  /** Whether a turn opened; a credit refusal before one is a refused start. */
  turnOpened = false;

  observe(event: ServerEvent): void {
    if (event.type === 'server.session.ready') this.turnOpened = true;
  }

  reset(): void {
    this.turnOpened = false;
  }
}

/**
 * The words for the three credit codes, or null for any other code.
 *
 * `credits_exhausted` and `credits_unavailable` end the leg (the session stops
 * itself). `credits_low` is a notice: translation keeps going, and the sentence
 * says so, because the popup shows it where it shows failures.
 */
export function creditErrorMessage(
  cause: RealtimeErrorCause | undefined,
  context: { turnOpened: boolean },
): string | null {
  switch (cause?.code) {
    case 'credits_exhausted':
      return context.turnOpened
        ? t('extension.credits.exhausted')
        : t('common.billing.startRefused');
    case 'credits_unavailable':
      return t('common.billing.unavailable');
    case 'credits_low':
      return cause.remainingCreditSeconds === undefined
        ? t('common.billing.lowUnknown')
        : t('common.billing.low', {
            credits: formatCredits(creditsFromSeconds(cause.remainingCreditSeconds)),
          });
    default:
      return null;
  }
}

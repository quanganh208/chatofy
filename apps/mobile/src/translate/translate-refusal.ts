/**
 * The server's refusal of a conversation start, in the reader's words.
 *
 * Only `language_unavailable` with a `detail` is named: it is the answer to an
 * "Auto-detect" start, and the server's English names the mechanism where the
 * reader needs the next step. Anything else hands the server's own message through.
 */

import type { MessageKey } from '@chatofy/i18n';
import type { ServerErrorCause } from '@chatofy/realtime-client';
import { creditsFromSeconds, type SessionLanguageMode } from '@chatofy/types';
import { creditAmountMessage, type CreditMessage } from '../billing/credit-amount.ts';

export function refusalMessageKey(cause: ServerErrorCause | undefined): MessageKey | null {
  if (cause?.code !== 'language_unavailable') return null;
  if (cause.detail === 'language_detection') return 'web.translate.detectUnavailable';
  if (cause.detail === 'lid_capacity') return 'web.translate.detectBusy';
  return null;
}

/**
 * Whether to tell the reader a conversation is running one way. True only when a
 * two-way start came back `declared`: a start that asked for nothing more has
 * nothing to explain.
 */
export function ranOneWayInstead(asked: boolean, granted: SessionLanguageMode | null): boolean {
  return asked && granted === 'declared';
}

/**
 * The words for a failed start or a dropped run, or null to show the server's own
 * message. A microphone permission refusal arrives as a plain error message from
 * the native recorder (`microphone permission not granted (Denied)`), so it is
 * recognised by that text; the server's refusals by their code.
 */
export function startFailureKey(
  message: string | null,
  cause: ServerErrorCause | undefined,
): MessageKey | null {
  const refusal = refusalMessageKey(cause);
  if (refusal) return refusal;
  if (message !== null && /permission not granted/i.test(message))
    return 'mobile.translate.micDenied';
  return null;
}

/** What the run has seen of its turns, read when a credit code arrives. */
export interface CreditContext {
  /** Whether any turn of this conversation was opened; none means the start itself was refused. */
  turnOpened: boolean;
}

/** A credit code in the reader's words. `notice` copy leaves the conversation running. */
export interface CreditCopy {
  key: MessageKey;
  /** Filled into the key's `{credits}`, itself translated first ("2 credits"). */
  amount?: CreditMessage;
  notice: boolean;
}

/**
 * The words for the three credit codes, or null for any other cause.
 *
 * `credits_exhausted` before any turn opened is a refused start, where "what was
 * said is saved" would be false; after one it ended the conversation. The
 * session stops itself on both of these and on `credits_unavailable`.
 * `credits_low` is only a notice: the session keeps translating, so it must not
 * read as a failure. Without an amount it has no sentence to fill, and the
 * caller shows the server's own text, still as a notice.
 */
export function creditErrorCopy(
  cause: ServerErrorCause | undefined,
  context: CreditContext,
): CreditCopy | null {
  switch (cause?.code) {
    case 'credits_exhausted':
      return {
        key: context.turnOpened ? 'common.billing.exhausted' : 'common.billing.startRefused',
        notice: false,
      };
    case 'credits_unavailable':
      return { key: 'common.billing.unavailable', notice: false };
    case 'credits_low': {
      if (cause.remainingCreditSeconds === undefined) return null;
      return {
        key: 'common.billing.low',
        amount: creditAmountMessage(creditsFromSeconds(cause.remainingCreditSeconds)),
        notice: true,
      };
    }
    default:
      return null;
  }
}

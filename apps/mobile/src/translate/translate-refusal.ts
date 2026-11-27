/**
 * A live-translation failure, in the reader's words.
 *
 * The session reports every failure with a stable code beside an English message
 * that is for logs only, so nothing here ever hands that message through: a code
 * without its own sentence gets the shared generic one.
 */

import { realtimeErrorKey, type MessageKey } from '@chatofy/i18n';
import type { RealtimeErrorCause } from '@chatofy/realtime-client';
import { creditsFromSeconds, type SessionLanguageMode } from '@chatofy/types';
import { creditAmountMessage, type CreditMessage } from '../billing/credit-amount.ts';

/**
 * Whether to tell the reader a conversation is running one way. True only when a
 * two-way start came back `declared`: a start that asked for nothing more has
 * nothing to explain.
 */
export function ranOneWayInstead(asked: boolean, granted: SessionLanguageMode | null): boolean {
  return asked && granted === 'declared';
}

/**
 * The words for a failed start or a dropped run. A microphone permission refusal
 * arrives as a plain error from the native recorder (`microphone permission not
 * granted (Denied)`) inside a failed start, so it is recognised by that text;
 * everything else by its code.
 */
export function startFailureKey(
  message: string,
  cause: RealtimeErrorCause | undefined,
): MessageKey {
  if (cause?.code === 'start_failed' && /permission not granted/i.test(message)) {
    return 'mobile.translate.micDenied';
  }
  return realtimeErrorKey(cause);
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
 * read as a failure. Without an amount it says the balance is low in general,
 * still as a notice.
 */
export function creditErrorCopy(
  cause: RealtimeErrorCause | undefined,
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
      if (cause.remainingCreditSeconds === undefined) {
        return { key: 'common.billing.lowUnknown', notice: true };
      }
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

/**
 * The server's refusal of a conversation start, in the reader's words.
 *
 * Only `language_unavailable` with a `detail` is named: it is the answer to an
 * "Auto-detect" start, and the server's English names the mechanism where the
 * reader needs the next step. Anything else hands the server's own message through.
 */

import type { MessageKey } from '@chatofy/i18n';
import type { SessionLanguageMode } from '@chatofy/types';

export interface ServerErrorCause {
  code: string;
  detail?: string;
}

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

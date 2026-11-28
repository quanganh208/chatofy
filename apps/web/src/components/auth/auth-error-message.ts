import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';
import type { MessageKey, Translate } from '@chatofy/i18n';

/** What a flow adds to the mapping: whether it spends a mailed link. */
export interface AuthErrorOptions {
  /**
   * The flow redeems a mailed link (verify email, reset password). A 401 there means
   * the link expired, was used, or belongs to a password since changed, and asking
   * for a new one is the only way forward.
   */
  redeemsLink?: boolean;
}

/**
 * What to show the user when an auth request fails.
 *
 * The four auth forms — register, forgot-password, reset-password and
 * verify-email — each carried their own copy of this mapping, identical except
 * for the last line. Three of the four strings it produces describe the
 * TRANSPORT, not the flow: "cannot reach the server" means the same thing on
 * every screen, so four copies could only ever drift apart, never usefully
 * diverge. Nothing tested them either, so a reworded copy or a dropped branch
 * would have gone out with the suite green.
 *
 * Only the last branch is per-flow, and it is the parameter.
 *
 * `login-form.tsx` deliberately does NOT use this. It signs in through Auth.js
 * rather than this API client, and it collapses every failure into one message
 * on purpose — telling a caller apart "no such account" from "wrong password"
 * is the account-existence oracle the whole auth design avoids.
 *
 * Returns a string rather than calling `setError` itself: reset-password and
 * verify-email clear `submitting` inside their `catch` while the other two use
 * `.finally`, and that difference belongs to the forms, not here.
 *
 * ## The API's own message is never shown
 *
 * `ApiClientError` carries the api's `message`, which is English and written for logs
 * and developers. The reader is told the failure from what is stable about it — the
 * status — in their own language: too many attempts, a mailed link that no longer
 * works, or the form's own fallback. A validation failure lands on the fallback too;
 * the form's own `minLength`/`required` checks are what catch those before a request.
 *
 * Everything the WEB decides — the contract mismatch, the two transport failures, and
 * each form's fallback — comes from the dictionary.
 */
export function authErrorMessage(
  err: unknown,
  t: Translate,
  fallback: MessageKey,
  { redeemsLink = false }: AuthErrorOptions = {},
): string {
  // The API answered. Its message is English for logs; see above.
  if (err instanceof ApiClientError) {
    if (err.status === 429) return t('common.auth.tooManyAttempts');
    if (redeemsLink && err.status === 401) return t('common.auth.linkExpired');
    return t(fallback);
  }

  // The API answered something the contract does not describe. The user cannot
  // act on the detail, and the detail is not theirs to see.
  if (err instanceof ContractError) return t('web.auth.unexpectedResponse');

  if (err instanceof NetworkError) {
    return t(err.timedOut ? 'web.auth.tookTooLong' : 'web.auth.serverUnreachable');
  }

  return t(fallback);
}

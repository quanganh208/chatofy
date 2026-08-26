import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';
import type { MessageKey, Translate } from '@chatofy/i18n';
import type { AuthMessageCode } from '@chatofy/types';

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
 * ## The one string that is not translated, and why
 *
 * `ApiClientError` carries the api's own `message`, and it passes through **in
 * English**. That is a known gap, not an oversight: a validation failure names the
 * field it was about and a bad link says which link, so the words are per-error and
 * there is no fixed set of them to key. Giving every api error a code is the fix, and
 * it is a change to the api's error contract rather than to this file.
 *
 * Everything the WEB decides — the contract mismatch, the two transport failures, and
 * each form's fallback — comes from the dictionary. So does every SUCCESS, which is
 * what {@link authSuccessMessage} is for: those had a fixed set of outcomes, so the
 * api now sends a code and each surface supplies its own words.
 */
export function authErrorMessage(err: unknown, t: Translate, fallback: MessageKey): string {
  // The API answered, and its message is written for a person — a validation
  // failure names the field, a bad link says it is a bad link. English; see above.
  if (err instanceof ApiClientError) return err.error.message;

  // The API answered something the contract does not describe. The user cannot
  // act on the detail, and the detail is not theirs to see.
  if (err instanceof ContractError) return t('web.auth.unexpectedResponse');

  if (err instanceof NetworkError) {
    return t(err.timedOut ? 'web.auth.tookTooLong' : 'web.auth.serverUnreachable');
  }

  return t(fallback);
}

/**
 * The words for an api success, chosen by its code.
 *
 * `RESET_REQUESTED` and its siblings are English minted by the api, and the most
 * prominent line on a Vietnamese auth page would have stayed English. The wire now
 * carries a code — `authMessageCodeSchema` in `@chatofy/types` — and this is the
 * table that turns it into prose the reader can actually read.
 *
 * Registration has exactly one code on purpose: a fresh address and an already
 * registered one answer identically, and two codes would be that oracle in
 * machine-readable form.
 */
const SUCCESS_KEY = {
  REGISTRATION_ACCEPTED: 'web.auth.checkYourEmail',
  ACCOUNT_CREATED: 'web.auth.noticeVerified',
  ACCOUNT_ALREADY_EXISTS: 'web.auth.accountExists',
  RESET_REQUESTED: 'web.auth.resetLinkSent',
  PASSWORD_RESET_DONE: 'web.auth.noticeReset',
} as const satisfies Record<AuthMessageCode, MessageKey>;

export function authSuccessMessage(code: AuthMessageCode, t: Translate): string {
  return t(SUCCESS_KEY[code]);
}

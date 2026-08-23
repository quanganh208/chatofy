import { ApiClientError, ContractError, NetworkError } from '@chatofy/api-client';

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
 */
export function authErrorMessage(err: unknown, fallback: string): string {
  // The API answered, and its message is written for a person — a validation
  // failure names the field, a bad link says it is a bad link.
  if (err instanceof ApiClientError) return err.error.message;

  // The API answered something the contract does not describe. The user cannot
  // act on the detail, and the detail is not theirs to see.
  if (err instanceof ContractError) return 'Unexpected response from the server.';

  if (err instanceof NetworkError) {
    return err.timedOut ? 'That took too long — try again.' : 'Cannot reach the server.';
  }

  return fallback;
}

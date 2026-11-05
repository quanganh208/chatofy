/**
 * What to tell the user when an email-flow request fails.
 *
 * Kept as a pure function over the error so every screen words a failure the
 * same way, and so it can be tested without a network.
 */

import type { MessageKey } from '@chatofy/i18n';
import { AuthRequestError } from '../clients/http-auth-client.ts';

export type AuthFlow = 'signUp' | 'forgotPassword' | 'verifyEmail' | 'resetPassword';

/** The wording for a flow that failed for a reason the user cannot act on. */
const GENERIC_FAILURE: Record<AuthFlow, MessageKey> = {
  signUp: 'web.auth.createFailed',
  forgotPassword: 'web.auth.sendResetFailed',
  verifyEmail: 'web.auth.verifyFailed',
  resetPassword: 'web.auth.resetFailed',
};

export function authFlowFailure(flow: AuthFlow, err: unknown): MessageKey {
  if (err instanceof AuthRequestError) {
    if (err.status === 429) return 'mobile.auth.tooManyAttempts';
    // A mailed token the API refuses is expired, already used, or for a password
    // that has since changed. Asking again is the only way forward.
    if ((flow === 'verifyEmail' || flow === 'resetPassword') && err.status === 401) {
      return 'mobile.auth.linkExpired';
    }
    return GENERIC_FAILURE[flow];
  }
  // The request timer aborts a hung API; a failed fetch is a TypeError.
  if (err instanceof Error && err.name === 'AbortError') return 'web.auth.tookTooLong';
  if (err instanceof TypeError) return 'web.auth.serverUnreachable';
  return GENERIC_FAILURE[flow];
}

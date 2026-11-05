/**
 * The pure half of "Continue with Google": which client ids are configured, how
 * an auth-session result reads, and what to say when the API refuses the token.
 * The hook and the button live in `components/auth`.
 */

import type { MessageKey } from '@chatofy/i18n';
import { AuthRequestError } from '../clients/http-auth-client.ts';

export interface GoogleClientIds {
  ios?: string;
  android?: string;
}

/** The id that applies to this platform, or undefined when the app has none for it. */
export function clientIdFor(
  platform: 'ios' | 'android' | string,
  ids: GoogleClientIds,
): string | undefined {
  // The app ships on iOS and Android only; any other platform has no client id.
  const id = platform === 'ios' ? ids.ios : platform === 'android' ? ids.android : undefined;
  const trimmed = id?.trim();
  return trimmed ? trimmed : undefined;
}

/** The slice of an auth-session response this reads, without importing the library here. */
export type GoogleAuthResponse =
  | { type: 'success'; params: Record<string, string | undefined> }
  | { type: 'error'; error?: unknown }
  | { type: 'cancel' | 'dismiss' | 'locked' | 'opened' }
  | null;

export type GoogleOutcome =
  | { kind: 'idle' }
  | { kind: 'idToken'; idToken: string }
  /** The user closed the Google sheet: not a failure, nothing to show. */
  | { kind: 'cancelled' }
  | { kind: 'failed' };

export function readGoogleResponse(response: GoogleAuthResponse): GoogleOutcome {
  if (!response) return { kind: 'idle' };
  switch (response.type) {
    case 'success': {
      const idToken = response.params['id_token'];
      // A success without the token is a misconfigured client, not a user choice.
      return idToken ? { kind: 'idToken', idToken } : { kind: 'failed' };
    }
    case 'cancel':
    case 'dismiss':
      return { kind: 'cancelled' };
    case 'error':
      return { kind: 'failed' };
    default:
      return { kind: 'idle' };
  }
}

/** What to tell the user when the API did not accept the Google id_token. */
export function googleFailureMessage(err: unknown): MessageKey {
  if (err instanceof AuthRequestError) {
    if (err.status === 401) return 'web.auth.googleRefused';
    if (err.status === 429) return 'mobile.auth.tooManyAttempts';
    // 501 is "this server has no Google login", 5xx a fault on our side.
    return 'web.auth.signInUnavailable';
  }
  if (err instanceof Error && err.name === 'AbortError') return 'web.auth.tookTooLong';
  if (err instanceof TypeError) return 'web.auth.serverUnreachable';
  return 'web.auth.signInUnavailable';
}

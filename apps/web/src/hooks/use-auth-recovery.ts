'use client';

import { useCallback, useMemo } from 'react';
import { signOut } from 'next-auth/react';
import { env } from '@/config/env';
import type { AccessTokenReader } from '@/hooks/use-access-token';

/**
 * Tell an expired session apart from a network fault, and act on it.
 *
 * There is no refresh flow, so this is the only recovery path there is. Without
 * it a user whose token has aged out looks signed in while every request 401s
 * and every socket is refused — indistinguishable from the API being down, and
 * they retry forever.
 *
 * The WebSocket case is why this is a probe rather than a close-code check. An
 * unauthenticated upgrade is refused with an HTTP 401 by `verifyClient`, and
 * browsers surface an aborted upgrade as a generic error with no status — there
 * is no code to read. So the client asks a question it CAN get an answer to:
 * `GET /auth/me`. A 401 means the session is gone; anything else means the
 * failure was the network's and retrying is right. It works identically for the
 * HTTP path.
 */
export interface AuthRecovery {
  /**
   * True when the failure was authentication — in which case the user has
   * already been signed out and sent to the login page.
   */
  handleConnectionFailure: () => Promise<boolean>;
}

export function useAuthRecovery(token: AccessTokenReader): AuthRecovery {
  const handleConnectionFailure = useCallback(async () => {
    // Still hydrating. A transport error in this window says nothing about the
    // session, and signing out here would eject a valid user over a slow first
    // paint — which is exactly what "no token yet" is not evidence of.
    if (token.isLoading()) return false;

    const accessToken = token.current();
    // Resolved, and there is genuinely no token: already the answer, no round
    // trip needed.
    if (!accessToken) {
      await signOut({ redirectTo: '/login' });
      return true;
    }

    let status: number;
    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/auth/me`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      status = res.status;
    } catch {
      // The probe itself could not reach the API — the strongest evidence there
      // is that the original failure was the network. Signing out here would
      // log people out over a flaky connection.
      return false;
    }

    if (status !== 401) return false;

    await signOut({ redirectTo: '/login' });
    return true;
  }, [token]);

  return useMemo(() => ({ handleConnectionFailure }), [handleConnectionFailure]);
}

'use client';

import { useCallback } from 'react';
import { signOut } from 'next-auth/react';
import { env } from '@/config/env';

/**
 * Tell an expired session apart from a network fault, and act on it.
 *
 * There is no refresh flow, so this is the only recovery path there is. Without
 * it a user whose token has aged out looks signed in while every request 401s
 * and every socket is refused — which is indistinguishable from the API being
 * down, and leaves them retrying forever.
 *
 * The WebSocket case is why this is a probe rather than a close-code check.
 * Phase 3 refuses unauthenticated upgrades with an HTTP 401 from `verifyClient`,
 * and browsers surface an aborted upgrade as a generic connection error with no
 * status attached — there is no code to read. So the client asks a question it
 * CAN get an answer to: `GET /auth/me`. A 401 means the session is gone; a
 * success means the socket failure was the network's fault and retrying is
 * right. One cheap request, and it works identically for the HTTP path.
 */
export interface AuthRecovery {
  /**
   * Returns true when the failure was authentication — in which case the user
   * has already been signed out and sent to the login page.
   */
  handleConnectionFailure: () => Promise<boolean>;
}

export function useAuthRecovery(accessToken: string): AuthRecovery {
  const handleConnectionFailure = useCallback(async () => {
    // No token at all is not worth a round trip; it is already the answer.
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
      // The probe itself could not reach the API, which is the strongest
      // evidence there is that the original failure was the network. Signing
      // out here would log people out over a flaky connection.
      return false;
    }

    if (status !== 401) return false;

    await signOut({ redirectTo: '/login' });
    return true;
  }, [accessToken]);

  return { handleConnectionFailure };
}

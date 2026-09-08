'use client';

import { useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { signOutOfChatofy } from '@/lib/sign-out';
import { recoverFromUnauthorized } from '@/lib/session-recovery';
import { env } from '@/config/env';
import type { AccessTokenReader } from '@/hooks/use-access-token';

/**
 * Tell an expired session apart from a network fault, and act on it.
 *
 * A 401 no longer means the session is over — it usually means the access token
 * has aged out and can be renewed — so this classifies and then delegates to
 * the shared recovery path rather than signing out on the spot. Without it a
 * user whose token aged out looks signed in while every request 401s and every
 * socket is refused, indistinguishable from the API being down, and they retry
 * forever.
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
  // `update`, NOT `getSession`, and this is load-bearing rather than a
  // preference. `getSession()` is a bare fetch that does not touch
  // SessionProvider's React state — and the socket path reads exactly that
  // state: `use-access-token` takes `useSession().data?.accessToken` into a ref
  // and the stream reconnects with it. Refreshing through `getSession()` would
  // succeed while the socket reconnected with the SAME expired token, be
  // refused at the upgrade, and loop until the provider's next poll — up to ten
  // minutes of a dead meeting. `update()` re-reads the session through the route
  // handler — a writable path, so renewal can persist there — and, unlike
  // `getSession()`, writes the result back into the provider state the socket
  // reads from. (Called with no argument it issues a GET, and `trigger` is never
  // `'update'`; what matters here is the state write, not the verb.)
  const { update } = useSession();

  const handleConnectionFailure = useCallback(async () => {
    // Still hydrating. A transport error in this window says nothing about the
    // session, and signing out here would eject a valid user over a slow first
    // paint — which is exactly what "no token yet" is not evidence of.
    if (token.isLoading()) return false;

    const accessToken = token.current();
    // Resolved, and there is genuinely no token: already the answer, no round
    // trip and nothing to renew.
    if (!accessToken) {
      await signOutOfChatofy();
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

    // A 401 from the probe is the START of recovery, not its conclusion. The
    // shared path attempts a renewal and signs out only when that renewal is
    // terminally refused — which is what keeps this from being a second, subtly
    // different sign-out rule.
    return (await recoverFromUnauthorized(update, accessToken)) === 'signed-out';
  }, [token, update]);

  return useMemo(() => ({ handleConnectionFailure }), [handleConnectionFailure]);
}

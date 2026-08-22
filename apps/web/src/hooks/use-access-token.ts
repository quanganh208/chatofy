'use client';

import { useSession } from 'next-auth/react';

/**
 * The Nest access token for the signed-in user, or an empty string.
 *
 * Empty rather than undefined so callers cannot forget the case: an empty token
 * produces a refused WebSocket upgrade and a 401, which is the correct outcome
 * for a page reached without a session, and the same outcome the route gate
 * already prevents from being reachable.
 *
 * Read through `useSession` rather than stored anywhere: there is no refresh
 * flow, so the session cookie is the single copy, and signing out takes effect
 * on the next connect instead of leaving a stale credential behind.
 */
export function useAccessToken(): string {
  const { data } = useSession();
  return data?.accessToken ?? '';
}

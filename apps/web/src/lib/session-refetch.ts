'use client';

import type { Session } from 'next-auth';
import { getCsrfToken } from 'next-auth/react';
import type { SessionRefetch } from '@/lib/session-recovery';

/**
 * Re-read the session in a way that FORCES a renewal attempt.
 *
 * `getSession()` cannot do this. It issues a GET, and next-auth sets
 * `trigger: 'update'` only on the POST branch of `/api/auth/session`, so the
 * `jwt` callback has no way to tell a routine read from "the API just refused
 * this token". Without that signal a 401 caused by REVOCATION rather than age —
 * a password change on another device — is unrecoverable: the callback sees an
 * `expiresAt` still minutes away, returns the identical dead token, and the
 * caller reads the unchanged token as a transient failure. The user then sits
 * signed-in on an app where every request 401s until the skew window opens on
 * its own, which is the exact symptom the rotating-session work exists to
 * remove.
 *
 * The POST body is empty on purpose. The callback ignores whatever is sent and
 * re-reads from the API; only the PRESENCE of the trigger is read here, so this
 * cannot become a way for client script to write into the signed cookie.
 *
 * Deliberately hand-rolled rather than routed through `useSession().update`:
 * `authedFetch` is a plain module, not a component, so there is no hook to call.
 * The socket path, which does have one, keeps using `update({})` because it also
 * needs the result written back into provider state.
 */
export const refetchSessionForcingRenewal: SessionRefetch = async () => {
  // `undefined`, NOT `null`, on every failure below. The two mean different
  // things to `recoverFromUnauthorized`: `null` is "asked, and there is no
  // session" and signs nobody out on its own, while `undefined` is "could not
  // ask at all". Returning `null` from a network blip would let that blip look
  // like evidence about the session.
  const csrfToken = await getCsrfToken();
  if (!csrfToken) return undefined;

  let res: Response;
  try {
    res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csrfToken, data: {} }),
    });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;

  const session = (await res.json().catch(() => null)) as Session | null;
  // next-auth answers `{}` rather than `null` when there is no session, and an
  // empty object would otherwise read as a session with no access token.
  if (!session || Object.keys(session).length === 0) return null;
  return session;
};

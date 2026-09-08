'use client';

import { signOut } from 'next-auth/react';

/**
 * Leaving, in one place — because three surfaces do it and they must agree.
 *
 * The sidebar avatar menu, the account page, and the recovery path that runs when a
 * token has aged out all end here. They are not three implementations of one action;
 * the first two are the same action reached two ways, and the third is the same
 * cleanup arriving involuntarily.
 *
 * **What this does and does NOT do — the boundary moved, so read it again.** It now
 * REVOKES THIS BROWSER'S REFRESH FAMILY server-side: the credential is dead the moment
 * you leave, rather than sitting renewable for the remainder of its thirty days. That
 * revocation is fired from the `signOut` EVENT in `auth.ts`, not from here, because the
 * refresh token lives in the httpOnly cookie and this file runs in the browser — it
 * could not read the token if it wanted to, which is the point.
 *
 * It is still NOT sign-out-everywhere. Other devices hold their own families and are
 * untouched, and the access token already issued runs out its remaining ≤15 minutes.
 * The only thing that ends every session at once is a COMPLETED password reset, which
 * also closes the user's open sockets. Any wording that implies otherwise is wrong,
 * not just imprecise.
 *
 * `/login` rather than `/` on the way out: the visitor was signed in a moment ago, so
 * the marketing page is not what they were looking for.
 */
export function signOutOfChatofy(): Promise<unknown> {
  return signOut({ redirectTo: '/login' });
}

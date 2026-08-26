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
 * **What this does NOT do, stated once so no copy overstates it.** It discards this
 * browser's session cookie. The API token that cookie carried stays valid until it
 * expires, and sessions on other devices are untouched. The only thing in this system
 * that revokes earlier tokens and closes a user's open sockets is a COMPLETED password
 * reset. There is no sign-out-everywhere, and this is not one — any wording that
 * implies otherwise is wrong, not just imprecise.
 *
 * `/login` rather than `/` on the way out: the visitor was signed in a moment ago, so
 * the marketing page is not what they were looking for.
 */
export function signOutOfChatofy(): Promise<unknown> {
  return signOut({ redirectTo: '/login' });
}

'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { signOutOfChatofy } from '@/lib/sign-out';

/**
 * Acts on a session that died while the tab sat idle.
 *
 * Without it the provider LEARNS the session is over — its own poll sets
 * `error` — and then nothing happens until the next navigation or API call. A
 * user who left a tab open comes back to a page that still looks signed in.
 * This is what makes "a dead session always lands on /login" observable rather
 * than eventual.
 *
 * Mounted inside the `(app)` group, never beside the provider in the root
 * layout — see that layout for the `/reset-password` flow it would otherwise
 * break.
 */
export function SessionGuard(): null {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error) void signOutOfChatofy();
  }, [session?.error]);

  return null;
}

'use client';

import { signOut, useSession } from 'next-auth/react';
import { Button } from '@chatofy/ui/react';

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing while the session is loading and nothing when signed out —
 * the only signed-out surface is the login page, which has no use for a sign-out
 * control, and a flash of "signed out" on every navigation is worse than a beat
 * of nothing.
 *
 * Signing out discards the cookie. The Nest token it carried stays valid until
 * it expires: there is no revocation, by decision, so this is a local sign-out
 * and not a session kill. Stated here so nobody adds a token blacklist assuming
 * this button already implies one.
 */
export function SessionMenu({ className }: { className?: string }) {
  const { data, status } = useSession();
  if (status !== 'authenticated') return null;

  return (
    <div className={className}>
      <span className="text-muted-foreground text-hint hidden sm:inline">{data.user?.email}</span>
      <Button
        id="sign-out"
        variant="ghost"
        size="sm"
        onClick={() => void signOut({ redirectTo: '/login' })}
      >
        Sign out
      </Button>
    </div>
  );
}

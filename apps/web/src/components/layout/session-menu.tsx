'use client';

import { signOut, useSession } from 'next-auth/react';
import { Button } from '@chatofy/ui/react';
import { useTranslate } from '@/i18n/provider';

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing while the session is loading and nothing when signed out —
 * the only signed-out surface is the login page, which has no use for a sign-out
 * control, and a flash of "signed out" on every navigation is worse than a beat
 * of nothing.
 *
 * Signing out discards the cookie. The Nest token it carried stays valid until
 * it expires — this is a local sign-out, not a session kill.
 *
 * That is still true even though revocation now exists: a completed PASSWORD
 * RESET invalidates earlier tokens and closes that user's open sockets, and
 * nothing else does. There is no logout-everywhere, and this button is not one.
 * Stated here so nobody adds a token blacklist assuming it already implies one,
 * and so nobody assumes the reverse — that because revocation exists, this must
 * already trigger it.
 */
export function SessionMenu({ className }: { className?: string }) {
  const { data, status } = useSession();
  const t = useTranslate();
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
        {t('web.chrome.signOut')}
      </Button>
    </div>
  );
}

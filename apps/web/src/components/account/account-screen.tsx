'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useSession } from 'next-auth/react';
import type { User } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { getMe } from '@/clients/api-client';
import { AccountIdentity } from '@/components/account/account-identity';
import { SettingsSection, SettingsRow } from '@/components/layout/settings-section';
import { useTranslate } from '@/i18n/provider';
import { signOutOfChatofy } from '@/lib/sign-out';

/**
 * Who this account is, and the two things you can do to it.
 *
 * Identity comes from two places for a reason. The session cookie already carries name
 * and email, so those render immediately; `GET /auth/me` adds `createdAt` and, in
 * failing, tells you the token behind the cookie has aged out. Waiting for the round
 * trip to show an address the page already knows would be a spinner over known data —
 * which is why the header renders at once and only the join date holds a place.
 *
 * ## One surface, and sign-out is not on it
 *
 * The screen used to be three cards: photo, identity, security. It is now a header on
 * the page ground, one elevated panel for security, and the way out below it.
 *
 * **Change password and sign out used to be the same control twice** — same variant,
 * same height, same fill, differing by an icon. One sends a reset email; the other
 * ends the session. Change password keeps the object weight, because it is this
 * screen's ordinary action; sign out drops to ghost and sits OUTSIDE the panel after
 * a gap, because it is the way out and it is already offered by the sidebar avatar
 * menu. Both call `signOutOfChatofy`, so this is one action reached two ways rather
 * than two implementations.
 *
 * **Not `destructive` ink.** Signing out destroys nothing: it discards this browser's
 * cookie and leaves the API token valid until it expires. The stronger sentence sits
 * on the password row instead, where it is true — a COMPLETED reset invalidates
 * earlier tokens and closes open sockets.
 *
 * There is no verified badge. The row is created by redeeming the verification link, so
 * an account that exists has always been verified and there is no `emailVerified`
 * column to read — a pill that can never say anything else looks like a check that
 * could fail, which is worse than saying nothing.
 */
export function AccountScreen() {
  const t = useTranslate();
  const { data } = useSession();
  const [profile, setProfile] = useState<User | 'failed'>();

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) setProfile(me);
      })
      .catch(() => {
        if (!cancelled) setProfile('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-10">
      <AccountIdentity
        name={data?.user?.name}
        email={data?.user?.email}
        avatarUrl={profile === undefined || profile === 'failed' ? undefined : profile.avatarUrl}
        memberSince={
          profile === undefined
            ? undefined
            : profile === 'failed'
              ? null
              : memberSince(profile.createdAt)
        }
      />

      <SettingsSection title={t('web.account.security')} panel>
        <SettingsRow label={t('web.auth.password')} note={t('web.account.changePasswordHint')}>
          <Button asChild variant="outline">
            <Link href="/forgot-password">{t('web.account.changePassword')}</Link>
          </Button>
        </SettingsRow>
      </SettingsSection>

      <div className="flex flex-col gap-2">
        <Button
          id="sign-out-account"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => void signOutOfChatofy()}
        >
          <LogOut aria-hidden />
          {t('web.chrome.signOut')}
        </Button>
        <p className="text-hint text-muted-foreground max-w-prose">
          {t('web.account.signOutHint')}
        </p>
      </div>
    </div>
  );
}

/**
 * The day the account was created, in the reader's own locale.
 *
 * `Intl` rather than a formatted string from the server: `createdAt` is an ISO instant
 * and the server has no idea which timezone or calendar convention the reader is in.
 * An unparseable value renders as itself instead of "Invalid Date".
 */
function memberSince(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

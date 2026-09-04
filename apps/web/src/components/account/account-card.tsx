'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useSession } from 'next-auth/react';
import type { User } from '@chatofy/types';
import { Button, Card, CardContent, Separator, Skeleton } from '@chatofy/ui/react';
import { getMe } from '@/clients/api-client';
import { AccountAvatarCard } from '@/components/account/account-avatar-card';
import { CardEyebrow } from '@/components/layout/card-eyebrow';
import { useTranslate } from '@/i18n/provider';
import { signOutOfChatofy } from '@/lib/sign-out';

/**
 * Who this account is, and the two things you can do to it.
 *
 * Identity comes from two places for a reason. The session cookie already carries name
 * and email, so those render immediately; `GET /auth/me` adds `createdAt` and, in
 * failing, tells you the token behind the cookie has aged out. Waiting for the round
 * trip to show an address the page already knows would be a spinner over known data.
 *
 * **Nothing here claims sign-out-everywhere**, because nothing here does that. Signing
 * out discards this browser's cookie and leaves the API token valid until it expires —
 * see `lib/sign-out.ts`, which is the one implementation both this button and the
 * sidebar avatar menu call. The stronger sentence sits on the password row instead,
 * where it is true: a COMPLETED reset invalidates earlier tokens and closes open
 * sockets.
 *
 * There is no verified badge. The row is created by redeeming the verification link, so
 * an account that exists has always been verified and there is no `emailVerified`
 * column to read — a pill that can never say anything else looks like a check that
 * could fail, which is worse than saying nothing.
 */
export function AccountCard() {
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

  const name = data?.user?.name;
  const email = data?.user?.email;

  return (
    <>
      {/* Held back until `getMe` answers, because `avatarUrl` decides whether the
          Remove control is reachable — rendering it from the session's `image`
          would flash a Remove button for an account that has no photo. The card
          is its own file; see the note there on why it is not a third card here. */}
      {profile !== undefined && profile !== 'failed' && (
        <AccountAvatarCard name={name} email={email} avatarUrl={profile.avatarUrl} />
      )}

      <Card>
        <CardContent className="flex flex-col gap-5">
          <CardEyebrow>{t('web.account.identity')}</CardEyebrow>
          <dl className="flex flex-col gap-4">
            <Field label={t('web.auth.name')} value={name || t('web.account.nameUnset')} />
            <Field label={t('web.auth.email')} value={email ?? ''} />
            <Field
              label={t('web.account.memberSince')}
              value={
                profile === undefined
                  ? undefined
                  : profile === 'failed'
                    ? t('web.account.loadFailed')
                    : memberSince(profile.createdAt)
              }
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-5">
          <CardEyebrow>{t('web.account.security')}</CardEyebrow>

          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" className="self-start">
              <Link href="/forgot-password">{t('web.account.changePassword')}</Link>
            </Button>
            <p className="text-hint text-muted-foreground max-w-prose">
              {t('web.account.changePasswordHint')}
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Button
              id="sign-out-account"
              variant="outline"
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
        </CardContent>
      </Card>
    </>
  );
}

/**
 * One labelled fact. `undefined` renders a skeleton at the value's height rather than
 * collapsing the row and pushing everything below it up when the answer arrives.
 */
function Field({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <dt className="text-muted-foreground text-hint font-semibold tracking-wide uppercase">
        {label}
      </dt>
      <dd className="text-body">
        {value === undefined ? <Skeleton className="h-4 w-32" /> : value}
      </dd>
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

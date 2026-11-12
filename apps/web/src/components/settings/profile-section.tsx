'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { User } from '@chatofy/types';
import { Avatar, AvatarFallback, AvatarImage, Button, Skeleton } from '@chatofy/ui/react';
import { getMe } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { ChangePhotoDialog } from './change-photo-dialog';
import { SettingsSection, SettingsSectionRow } from './settings-section';

/**
 * Settings › Profile, with its data: who the session says this is, and when the
 * account was made.
 *
 * Identity comes from two places for a reason. The session cookie already carries
 * name, email and photo, so those render immediately; `GET /auth/me` adds
 * `createdAt` and the stored photo. Waiting for the round trip to show an address
 * the page already knows would be a spinner over known data, so only the join date
 * holds a place.
 */
export function ProfileSettings() {
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
    <ProfileSection
      name={data?.user?.name}
      email={data?.user?.email}
      avatarUrl={profile === undefined || profile === 'failed' ? undefined : profile.avatarUrl}
      sessionImage={data?.user?.image}
      memberSince={
        profile === undefined
          ? undefined
          : profile === 'failed'
            ? null
            : memberSince(profile.createdAt)
      }
    />
  );
}

/**
 * The profile rows: photo, name, email, member since. "Change photo" opens a dialog
 * (`change-photo-dialog.tsx`), which is where removing the photo lives too.
 *
 * **No accent control.** This page spends ZERO `bg-primary` controls: changing a
 * photo is an ordinary action, so its trigger is outline; the dialog's own pick
 * button is that state's one filled control.
 *
 * **Remove is offered only when there is a photo.** `avatarUrl` is ALSO null when
 * the row has a key but the server's public origin is unset, which hides Remove for
 * an account that does have one. Reaching it means configuring an environment
 * downward after an upload; restoring the variable restores the control.
 *
 * There is no verified badge. The row is created by redeeming the verification
 * link, so an account that exists has always been verified.
 */
export function ProfileSection({
  name,
  email,
  avatarUrl,
  sessionImage,
  memberSince,
}: {
  name?: string | null;
  email?: string | null;
  /** `undefined` until `GET /auth/me` answers, and if it never does. */
  avatarUrl?: string | null;
  /**
   * The photo the session cookie already carries: the fallback for as long as
   * `avatarUrl` is unknown — the first paint, and forever if the lookup failed.
   * Without it a failed lookup would draw initials for an account that has a photo
   * and hide the only control that can remove it.
   */
  sessionImage?: string | null;
  /** The rendered join date: `undefined` while in flight, `null` when it failed. */
  memberSince?: string | null;
}) {
  const t = useTranslate();
  // The prop is the truth until this browser changes the photo, and then the local
  // value is. `undefined` is "no local change yet": an upload resolves to a string
  // and a removal to `null`, so neither can be confused with it.
  const [changed, setChanged] = useState<string | null>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const current =
    changed !== undefined ? changed : avatarUrl !== undefined ? avatarUrl : (sessionImage ?? null);
  const letters = initials(name, email);

  return (
    <SettingsSection>
      <SettingsSectionRow label={t('web.settings.photo')}>
        <Avatar size="lg">
          <AvatarImage src={current ?? undefined} alt="" />
          <AvatarFallback>{letters}</AvatarFallback>
        </Avatar>
        <Button
          id="photo-change-open"
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
        >
          {t('web.account.avatarChange')}
        </Button>
      </SettingsSectionRow>
      <SettingsSectionRow label={t('web.auth.name')}>
        <span className="text-body text-prose truncate">{name || t('web.account.nameUnset')}</span>
      </SettingsSectionRow>
      <SettingsSectionRow label={t('common.auth.email')}>
        <span className="text-body text-prose break-all">{email ?? ''}</span>
      </SettingsSectionRow>
      <SettingsSectionRow label={t('web.account.memberSince')}>
        {/* The height is held whether or not the answer has arrived. A `span`, not a
            `p`: `Skeleton` is a `div`, and a `div` inside a `p` fails hydration. */}
        <span className="text-body text-prose flex min-h-5 items-center">
          {memberSince === undefined ? (
            <Skeleton className="h-3 w-32" />
          ) : memberSince === null ? (
            <span className="text-muted-foreground text-hint">{t('web.account.loadFailed')}</span>
          ) : (
            memberSince
          )}
        </span>
      </SettingsSectionRow>

      <ChangePhotoDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        current={current}
        initials={letters}
        onChanged={({ avatarUrl: next }) => setChanged(next)}
      />
    </SettingsSection>
  );
}

/**
 * The day the account was created, in the reader's own locale. An unparseable value
 * renders as itself instead of "Invalid Date".
 */
function memberSince(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Same two-letter rule the sidebar uses — see `session-menu.tsx` for the why. */
function initials(name?: string | null, email?: string | null): string {
  const source = (name ?? email ?? '').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  const letters =
    first !== undefined && last !== undefined && first !== last
      ? [Array.from(first)[0] ?? '', Array.from(last)[0] ?? '']
      : Array.from(source).slice(0, 2);
  return letters.join('').toUpperCase();
}

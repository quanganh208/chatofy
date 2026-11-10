'use client';

import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useSession } from 'next-auth/react';
import type { User } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { getMe } from '@/clients/api-client';
import { AccountIdentity } from '@/components/account/account-identity';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { CreditsSection } from '@/components/account/credits-section';
import { SettingsSection, SettingsSectionRow } from '@/components/layout/settings-section';
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
 * same height, same fill, differing by an icon. One changes the password; the other
 * ends the session. Change password keeps the object weight, because it is this
 * screen's ordinary action; sign out drops to ghost and sits OUTSIDE the panel after
 * a gap, because it is the way out and it is already offered by the sidebar avatar
 * menu. Both call `signOutOfChatofy`, so this is one action reached two ways rather
 * than two implementations.
 *
 * **Not `destructive` ink.** Signing out destroys nothing: it discards this browser's
 * cookie and leaves the API token valid until it expires. The stronger sentence sits
 * on the password row instead, where it is true — a password change invalidates every
 * other device's tokens and closes open sockets, while this browser is handed a
 * replacement session and stays signed in.
 *
 * **The form opens inside the panel, not in a dialog.** It is the row's own action
 * expanded, so it adds no surface; its submit is that state's one filled control, and
 * the outline button that opened it is gone while it is open, so the two never compete.
 *
 * **Credits sit between identity and security, on the ground.** They are a
 * balance and a list — readouts — so they add no surface, and every buy action
 * in them is outline, so the screen still spends no accent. See `credits-section.tsx`.
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
  const [changing, setChanging] = useState(false);
  const [changed, setChanged] = useState(false);

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
    <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
      <div className="lg:col-span-2">
        <AccountIdentity
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
      </div>

      {/* Full width so Security and Session still pair up on the row below. */}
      <div className="lg:col-span-2">
        <CreditsSection />
      </div>

      <SettingsSection title={t('web.account.security')} panel>
        <SettingsSectionRow
          label={t('common.auth.password')}
          note={t('web.account.changePasswordHint')}
        >
          {changing ? null : (
            <Button
              id="change-password-open"
              variant="outline"
              onClick={() => {
                setChanged(false);
                setChanging(true);
              }}
            >
              {t('web.account.changePassword')}
            </Button>
          )}
        </SettingsSectionRow>
        {changing ? (
          <ChangePasswordForm
            onCancel={() => setChanging(false)}
            onDone={() => {
              setChanging(false);
              setChanged(true);
            }}
          />
        ) : null}
        {/* Always mounted, filled on success: a live region has to exist before its
            content changes to be announced — see `auth-alert.tsx`. */}
        <p role="status" className={changed ? 'text-prose text-hint pb-3.5' : undefined}>
          {changed ? t('web.account.passwordChanged') : null}
        </p>
      </SettingsSection>

      <SettingsSection title={t('web.account.session')} panel>
        <SettingsSectionRow
          label={t('web.account.thisBrowser')}
          note={t('web.account.signOutHint')}
        >
          <Button id="sign-out-account" variant="outline" onClick={() => void signOutOfChatofy()}>
            <LogOut aria-hidden />
            {t('common.auth.signOut')}
          </Button>
        </SettingsSectionRow>
      </SettingsSection>
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

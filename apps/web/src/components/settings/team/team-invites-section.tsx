'use client';

import { useState } from 'react';
import type { TeamInvite, TeamSummary } from '@chatofy/types';
import { Button } from '@chatofy/ui/react';
import { useTeamInvites } from '@/hooks/use-team-invites';
import { useLocale, useTranslate } from '@/i18n/provider';
import { SettingsSection } from '../settings-section';
import { TeamInviteForm } from './team-invite-form';

/**
 * Owner and admins: invite by email, then the open invites under the form, each with
 * when it lapses, so the list reads as the result of what was just done above it.
 */
export function TeamInvitesSection({ team }: { team: TeamSummary }) {
  const t = useTranslate();
  const locale = useLocale();
  const { invites, status, retry, create, revoke } = useTeamInvites(team.id, true);
  const [revokeFailed, setRevokeFailed] = useState(false);

  return (
    <SettingsSection title={t('web.team.inviteHeading')}>
      <TeamInviteForm canInviteAdmin={team.role === 'owner'} create={create} />
      {invites.length === 0 && status === 'failed' && (
        <div data-invites-failed className="flex items-center gap-3 py-3">
          <p role="alert" className="text-destructive text-prose flex-1">
            {t('web.team.loadFailed')}
          </p>
          <Button variant="outline" size="sm" onClick={() => void retry()}>
            {t('web.team.retry')}
          </Button>
        </div>
      )}
      {invites.map((invite) => (
        <div key={invite.id} data-invite-row className="flex items-center gap-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-body truncate">{invite.email}</span>
            <span data-invite-status={invite.status} className="text-muted-foreground text-hint">
              {inviteStatus(invite, locale, t)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRevokeFailed(false);
              revoke(invite.id).catch(() => setRevokeFailed(true));
            }}
          >
            {t('web.team.inviteRevoke')}
          </Button>
        </div>
      ))}
      {revokeFailed && (
        <p role="alert" className="text-destructive text-hint py-3">
          {t('web.team.actionFailed')}
        </p>
      )}
    </SettingsSection>
  );
}

/** "Pending · expires 21 Nov", or "Expired"; plain "Invite pending" if the date does not parse. */
function inviteStatus(
  invite: TeamInvite,
  locale: string,
  t: ReturnType<typeof useTranslate>,
): string {
  if (invite.status === 'expired') return t('web.team.inviteExpired');
  const expires = new Date(invite.expiresAt);
  if (Number.isNaN(expires.getTime())) return t('web.team.invitePending');
  return t('web.team.invitePendingUntil', {
    date: expires.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
  });
}

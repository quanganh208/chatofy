'use client';

import { useState } from 'react';
import type { TeamSummary } from '@chatofy/types';
import { Badge, Button } from '@chatofy/ui/react';
import { useTeamInvites } from '@/hooks/use-team-invites';
import { useTranslate } from '@/i18n/provider';
import { SettingsSection } from '../settings-section';
import { TeamInviteForm } from './team-invite-form';

/** Owner and admins: invite by email and withdraw open invites. */
export function TeamInvitesSection({ team }: { team: TeamSummary }) {
  const t = useTranslate();
  const { invites, status, retry, create, revoke } = useTeamInvites(team.id, true);
  const [revokeFailed, setRevokeFailed] = useState(false);

  return (
    <SettingsSection title={t('web.team.invites')}>
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
          <span className="text-body min-w-0 flex-1 truncate">{invite.email}</span>
          <Badge variant="outline">
            {t(invite.status === 'pending' ? 'web.team.invitePending' : 'web.team.inviteExpired')}
          </Badge>
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

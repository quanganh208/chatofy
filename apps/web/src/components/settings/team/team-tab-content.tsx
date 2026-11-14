'use client';

import type { TeamSummary } from '@chatofy/types';
import { Button, Skeleton } from '@chatofy/ui/react';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { useTeamMembers } from '@/hooks/use-team-members';
import { useTranslate } from '@/i18n/provider';
import { TeamInvitesSection } from './team-invites-section';
import { TeamManageSection } from './team-manage-section';
import { TeamMembersSection } from './team-members-section';
import { TeamOverviewSection } from './team-overview-section';

/**
 * Settings › Team follows the workspace: in personal it lists your teams and creates
 * one; in a team it manages that team, by the viewer's role. While the workspace is
 * still resolving it shows a placeholder, or a retry when the team list failed.
 */
export function TeamTabContent() {
  const t = useTranslate();
  const { workspace, teamsStatus, reloadTeams } = useWorkspace();

  switch (workspace.kind) {
    case 'resolving':
      return teamsStatus === 'failed' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-destructive text-prose">
            {t('web.team.loadFailed')}
          </p>
          <Button variant="outline" onClick={() => void reloadTeams()}>
            {t('web.team.retry')}
          </Button>
        </div>
      ) : (
        <Skeleton className="h-24 w-full" />
      );
    case 'personal':
      return <TeamOverviewSection />;
    case 'team':
      // Keyed by team: every list, form and open dialog starts over on a switch, so
      // nothing captured for one team can act on another.
      return <TeamView key={workspace.team.id} team={workspace.team} />;
  }
}

function TeamView({ team }: { team: TeamSummary }) {
  const members = useTeamMembers(team.id);
  return (
    <div className="flex flex-col gap-6">
      <TeamMembersSection team={team} {...members} />
      {team.role !== 'member' && <TeamInvitesSection team={team} />}
      <TeamManageSection team={team} members={members.members} />
    </div>
  );
}

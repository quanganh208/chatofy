'use client';

import { useState } from 'react';
import { TEAM_LIMITS, type TeamSummary } from '@chatofy/types';
import { Button, Skeleton } from '@chatofy/ui/react';
import { consumeTeamCreateIntent } from '@/components/workspace/team-create-intent';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { WorkspaceTile } from '@/components/workspace/workspace-tile';
import { useTeamMembers } from '@/hooks/use-team-members';
import { useTranslate } from '@/i18n/provider';
import { ROLE_KEY } from './team-copy';
import { TeamInvitesSection } from './team-invites-section';
import { TeamManageSection } from './team-manage-section';
import { TeamCreateForm } from './team-create-form';
import { TeamMembersSection } from './team-members-section';
import { TeamOverviewSection } from './team-overview-section';

/**
 * Settings › Team follows the workspace: in personal it lists your teams and creates
 * one; in a team it manages that team, by the viewer's role. While the workspace is
 * still resolving it shows a placeholder, or a retry when the team list failed.
 *
 * A request from outside Settings to start a team (`requestTeamCreateForm`) is taken
 * once, when the tab mounts, and shows the create form over whichever workspace the
 * reader is in: nothing switches until a team exists. The request belongs to that
 * workspace and ends on Cancel or when the workspace changes — a create succeeding
 * is such a change — so no later visit to the personal view opens on the form.
 */
export function TeamTabContent() {
  const t = useTranslate();
  const { workspace, teamsStatus, reloadTeams } = useWorkspace();
  const here = workspace.kind === 'team' ? workspace.team.id : workspace.kind;
  // `pending` until the workspace settles, then the workspace it was asked in.
  const [createIn, setCreateIn] = useState<string | null>(() =>
    consumeTeamCreateIntent() ? 'pending' : null,
  );
  if (createIn !== null && here !== 'resolving' && createIn !== here) {
    // Adjusting state from the previous render, React's documented pattern: pin the
    // request to the workspace it settled in, or end it once the reader is elsewhere.
    setCreateIn(createIn === 'pending' ? here : null);
  }

  if (createIn === here) {
    return <TeamCreateForm onCancel={() => setCreateIn(null)} />;
  }

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

/**
 * One team, top to bottom: which team this is, who is in it, how to add people,
 * its name, and the acts that cannot be undone, last and in the destructive colour.
 */
function TeamView({ team }: { team: TeamSummary }) {
  const t = useTranslate();
  const members = useTeamMembers(team.id);
  // The live list once it has loaded; the summary's count until then.
  const count = members.members.length > 0 ? members.members.length : team.memberCount;
  return (
    <div className="flex flex-col gap-6">
      <div data-team-header className="flex items-center gap-3 px-1">
        <WorkspaceTile kind="team" name={team.name} size="lg" />
        <div className="flex min-w-0 flex-col">
          <span className="text-body font-medium break-words">{team.name}</span>
          <span className="text-muted-foreground text-hint">
            {t('web.team.headerSubline', {
              role: t(ROLE_KEY[team.role]),
              count,
              max: TEAM_LIMITS.MAX_SEATS_PER_TEAM,
            })}
          </span>
        </div>
      </div>
      <TeamMembersSection team={team} {...members} />
      {team.role !== 'member' && <TeamInvitesSection team={team} />}
      <TeamManageSection team={team} members={members.members} />
    </div>
  );
}

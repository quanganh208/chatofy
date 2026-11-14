'use client';

import { useId, useState } from 'react';
import { TEAM_LIMITS, type TeamMemberEntry, type TeamSummary } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { deleteTeam, removeTeamMember, renameTeam } from '@/clients/teams-api-client';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { useTranslate } from '@/i18n/provider';
import { SettingsSection } from '../settings-section';
import { TeamConfirmDialog } from './team-confirm-dialog';

/**
 * The owner renames or deletes the team; anyone else may leave it. Each request is
 * sent with the team id this view was mounted for, never a live read of the
 * workspace, and lands the tab back in personal afterwards.
 */
export function TeamManageSection({
  team,
  members,
}: {
  team: TeamSummary;
  members: TeamMemberEntry[];
}) {
  const t = useTranslate();
  const { reloadTeams, select } = useWorkspace();
  const teamId = team.id;
  const backToPersonal = async () => {
    select('personal');
    await reloadTeams();
  };

  if (team.role !== 'owner') {
    const self = members.find((member) => member.isSelf);
    return (
      <SettingsSection>
        <div className="py-3.5">
          <TeamConfirmDialog
            slot="leave"
            trigger={t('web.team.leave')}
            title={t('web.team.leaveConfirmTitle', { name: team.name })}
            body={t('web.team.leaveConfirmBody')}
            action={t('web.team.leave')}
            ready={self !== undefined}
            onConfirm={async () => {
              if (!self) return;
              await removeTeamMember(teamId, self.id);
              await backToPersonal();
            }}
          />
        </div>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection>
      <RenameRow team={team} onSaved={reloadTeams} />
      <div className="py-3.5">
        <DeleteTeam team={team} onDeleted={backToPersonal} />
      </div>
    </SettingsSection>
  );
}

function RenameRow({ team, onSaved }: { team: TeamSummary; onSaved: () => Promise<void> }) {
  const t = useTranslate();
  const id = useId();
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = name.trim();

  return (
    <form
      className="flex flex-col gap-2 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed || trimmed === team.name || busy) return;
        setBusy(true);
        setFailed(false);
        renameTeam(team.id, { name: trimmed })
          .then(onSaved)
          .catch(() => setFailed(true))
          .finally(() => setBusy(false));
      }}
    >
      <Label htmlFor={id}>{t('web.team.rename')}</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          maxLength={TEAM_LIMITS.MAX_NAME_CHARS}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="sm:flex-1"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !trimmed || trimmed === team.name}
        >
          {t('web.team.renameSubmit')}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="text-destructive text-hint">
          {t('web.team.actionFailed')}
        </p>
      )}
    </form>
  );
}

/** Deleting asks for the team's exact name first: it removes the library for everyone. */
function DeleteTeam({ team, onDeleted }: { team: TeamSummary; onDeleted: () => Promise<void> }) {
  const t = useTranslate();
  const id = useId();
  const [typed, setTyped] = useState('');

  return (
    <TeamConfirmDialog
      slot="delete"
      trigger={t('web.team.delete')}
      title={t('web.team.deleteConfirmTitle', { name: team.name })}
      body={t('web.team.deleteConfirmBody')}
      action={t('web.team.delete')}
      ready={typed === team.name}
      onConfirm={async () => {
        await deleteTeam(team.id);
        await onDeleted();
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>{t('web.team.nameLabel')}</Label>
        <Input
          id={id}
          data-delete-confirm-name
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </div>
    </TeamConfirmDialog>
  );
}

'use client';

import { useId, useState } from 'react';
import { TEAM_LIMITS, type TeamMemberEntry, type TeamSummary } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { deleteTeam, removeTeamMember, renameTeam } from '@/clients/teams-api-client';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { isTeamGone } from '@/hooks/use-team-list';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { SettingsSection, SettingsSectionRow } from '../settings-section';
import { TeamConfirmDialog } from './team-confirm-dialog';

/**
 * The team's own settings, below its members and invites: the owner gets a "Team
 * name" section and a "Danger zone" holding Delete; anyone else gets a Danger zone
 * holding Leave. Each request is sent with the team id this view was mounted for,
 * never a live read of the workspace, and lands the tab back in personal afterwards
 * with a toast saying what happened.
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
  /**
   * A 404 means the team is already gone for this caller: go where the outcome is,
   * and say it, since the reader's intent was carried out either way.
   */
  const orGone = async (write: () => Promise<unknown>, done: string) => {
    try {
      await write();
    } catch (err) {
      if (!isTeamGone(err)) throw err;
    }
    await backToPersonal();
    notify.success(done);
  };

  if (team.role !== 'owner') {
    const self = members.find((member) => member.isSelf);
    return (
      <SettingsSection title={t('web.team.dangerZone')} danger>
        <SettingsSectionRow label={t('web.team.leaveRowLabel')} note={t('web.team.leaveRowNote')}>
          <TeamConfirmDialog
            slot="leave"
            trigger={t('web.team.leave')}
            title={t('web.team.leaveConfirmTitle', { name: team.name })}
            body={t('web.team.leaveConfirmBody')}
            action={t('web.team.leave')}
            ready={self !== undefined}
            onConfirm={async () => {
              if (!self) return;
              await orGone(
                () => removeTeamMember(teamId, self.id),
                t('web.team.leftToast', { name: team.name }),
              );
            }}
          />
        </SettingsSectionRow>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection title={t('web.team.nameHeading')}>
        <RenameRow team={team} onSaved={reloadTeams} onGone={backToPersonal} />
      </SettingsSection>
      <SettingsSection title={t('web.team.dangerZone')} danger>
        <SettingsSectionRow label={t('web.team.deleteRowLabel')} note={t('web.team.deleteRowNote')}>
          <DeleteTeam
            team={team}
            remove={(write) => orGone(write, t('web.team.deletedToast', { name: team.name }))}
          />
        </SettingsSectionRow>
      </SettingsSection>
    </>
  );
}

function RenameRow({
  team,
  onSaved,
  onGone,
}: {
  team: TeamSummary;
  onSaved: () => Promise<void>;
  onGone: () => Promise<void>;
}) {
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
          .catch((err: unknown) => (isTeamGone(err) ? onGone() : setFailed(true)))
          .finally(() => setBusy(false));
      }}
    >
      {/* The section heading already says "Team name"; the label stays for the field. */}
      <Label htmlFor={id} className="sr-only">
        {t('web.team.rename')}
      </Label>
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
function DeleteTeam({
  team,
  remove,
}: {
  team: TeamSummary;
  remove: (write: () => Promise<unknown>) => Promise<void>;
}) {
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
        await remove(() => deleteTeam(team.id));
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

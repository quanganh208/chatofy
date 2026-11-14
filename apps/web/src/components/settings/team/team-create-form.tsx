'use client';

import { useId, useState } from 'react';
import type { MessageKey } from '@chatofy/i18n';
import { TEAM_LIMITS } from '@chatofy/types';
import { Button, Input, Label } from '@chatofy/ui/react';
import { createTeam } from '@/clients/teams-api-client';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { useTranslate } from '@/i18n/provider';
import { refusalKey } from './team-copy';

/** Name a new team and switch to it. Its Create is the tab's only filled control. */
export function TeamCreateForm({ onCancel }: { onCancel: () => void }) {
  const t = useTranslate();
  const id = useId();
  const { reloadTeams, select } = useWorkspace();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const trimmed = name.trim();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed || busy) return;
        setBusy(true);
        setError(null);
        createTeam({ name: trimmed }).then(
          async ({ team }) => {
            await reloadTeams();
            select(team.id);
          },
          (err: unknown) => {
            setBusy(false);
            setError(refusalKey(err, { 409: 'web.team.createRefused' }));
          },
        );
      }}
    >
      <Label htmlFor={id}>{t('web.team.nameLabel')}</Label>
      <Input
        id={id}
        name="team-name"
        autoFocus
        maxLength={TEAM_LIMITS.MAX_NAME_CHARS}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {error && (
        <p role="alert" className="text-destructive text-hint">
          {t(error, { max: TEAM_LIMITS.MAX_TEAMS_PER_USER })}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !trimmed}>
          {t('web.team.createSubmit')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('web.team.cancel')}
        </Button>
      </div>
    </form>
  );
}

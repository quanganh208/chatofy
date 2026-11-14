'use client';

import { useState } from 'react';
import { Badge, Button } from '@chatofy/ui/react';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { useTranslate } from '@/i18n/provider';
import { SettingsSection } from '../settings-section';
import { ROLE_KEY } from './team-copy';
import { TeamCreateForm } from './team-create-form';

/**
 * Personal workspace: the teams you are in, each opened by switching to it, and the
 * way to make one. Nothing here is filled until the create form opens, whose Create
 * is then the tab's one accent.
 */
export function TeamOverviewSection() {
  const t = useTranslate();
  const { teams, select } = useWorkspace();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {teams.length === 0 ? (
        <div className="flex flex-col gap-1 px-1">
          <p className="text-prose font-medium">{t('web.team.none')}</p>
          <p className="text-muted-foreground text-hint max-w-[62ch]">{t('web.team.noneHint')}</p>
        </div>
      ) : (
        <SettingsSection title={t('web.team.yourTeams')}>
          {teams.map((team) => (
            <div key={team.id} data-team-row className="flex items-center gap-3 py-3">
              <span className="text-body min-w-0 flex-1 truncate">{team.name}</span>
              <Badge variant="secondary">{t(ROLE_KEY[team.role])}</Badge>
              <Button variant="ghost" size="sm" onClick={() => select(team.id)}>
                {t('web.team.open')}
              </Button>
            </div>
          ))}
        </SettingsSection>
      )}
      {creating ? (
        <TeamCreateForm onCancel={() => setCreating(false)} />
      ) : (
        <Button
          variant="outline"
          className="self-start"
          data-team-create
          onClick={() => setCreating(true)}
        >
          {t('web.team.create')}
        </Button>
      )}
    </div>
  );
}

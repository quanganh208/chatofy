'use client';

import { Users } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@chatofy/ui/react';
import { openSettingsDialog } from '@/components/settings/use-settings-dialog';
import { useTranslate } from '@/i18n/provider';
import { SHEET_ROW_CLASS } from '@/components/layout/tab-bar-styles';
import { cn } from '@/lib/utils';
import { useWorkspace } from './workspace-provider';

/**
 * Which library this tab manages: personal, or one of the caller's teams.
 *
 * In the sidebar at `md` and up, and as a row of the More sheet below it, where the
 * sidebar does not exist. Nothing here is filled: a switcher is a readout of where
 * you are, not the screen's action.
 */
export function WorkspaceSwitcher({ variant }: { variant: 'sidebar' | 'sheet-row' }) {
  const t = useTranslate();
  const { workspace, teams, teamsStatus, select, reloadTeams } = useWorkspace();

  const label =
    workspace.kind === 'team'
      ? workspace.team.name
      : workspace.kind === 'personal'
        ? t('web.workspace.personal')
        : t('web.workspace.label');
  const active = workspace.kind === 'team' ? workspace.team.id : 'personal';

  const menu = (
    <DropdownMenuContent align="start" className="w-60">
      <DropdownMenuLabel>{t('web.workspace.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={active} onValueChange={select}>
        <DropdownMenuRadioItem value="personal">
          {t('web.workspace.personal')}
        </DropdownMenuRadioItem>
        {teams.map((team) => (
          <DropdownMenuRadioItem key={team.id} value={team.id} className="break-words">
            {team.name}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {teamsStatus === 'failed' && (
        <>
          <p role="alert" className="text-destructive text-hint px-2 py-1.5">
            {t('web.team.loadFailed')}
          </p>
          <DropdownMenuItem onSelect={() => void reloadTeams()}>
            {t('web.team.retry')}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => openSettingsDialog('team')}>
        {t('web.workspace.manageTeams')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );

  if (variant === 'sheet-row') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-workspace-switcher
            aria-label={t('web.workspace.switchTo')}
            className={cn(SHEET_ROW_CLASS, 'text-left')}
          >
            <Users aria-hidden />
            <span className="truncate">{label}</span>
          </button>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              tooltip={label}
              data-workspace-switcher
              aria-label={t('web.workspace.switchTo')}
            >
              <Users aria-hidden />
              <span className="truncate">{label}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

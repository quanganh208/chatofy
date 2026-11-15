'use client';

import { ChevronsUpDown } from 'lucide-react';
import {
  Button,
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
import { ROLE_KEY } from '@/components/settings/team/team-copy';
import { useSessionIdentity } from '@/components/layout/session-identity';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';
import { requestTeamCreateForm } from './team-create-intent';
import { useWorkspace } from './workspace-provider';
import { WorkspaceTile } from './workspace-tile';

/**
 * Which library this tab manages: personal, or one of the caller's teams.
 *
 * Two triggers over ONE menu, one per breakpoint: the sidebar header at `md` and up,
 * and a chip at the right end of the topbar below it, where the sidebar does not
 * exist — so the translate screen on a phone still says whose library it is using.
 *
 * Nothing here is filled: a switcher is a readout of where you are, not the screen's
 * action. The chip's edge is an inset hairline, not the outline button's lift.
 */
export function WorkspaceSwitcher({ variant }: { variant: 'sidebar' | 'chip' }) {
  const t = useTranslate();
  const identity = useSessionIdentity();
  const { workspace } = useWorkspace();
  const personal = t('web.workspace.personal');
  // The personal tile carries the reader's own initial, so it reads as "mine".
  const personalTileName = identity.name ?? identity.email ?? personal;

  const current =
    workspace.kind === 'team'
      ? {
          tile: <WorkspaceTile kind="team" name={workspace.team.name} size="md" />,
          name: workspace.team.name,
          subline: t('web.workspace.teamSubline', { role: t(ROLE_KEY[workspace.team.role]) }),
        }
      : workspace.kind === 'personal'
        ? {
            tile: <WorkspaceTile kind="personal" name={personalTileName} size="md" />,
            // Beside a "Personal" subline, the reader's name is what tells it apart.
            name: personalTileName,
            subline: personal,
          }
        : {
            // Resolving: a blank square rather than a guess that may be a team a
            // moment later.
            tile: <span aria-hidden className="bg-muted size-6 shrink-0 rounded-md" />,
            name: t('web.workspace.label'),
            subline: undefined,
          };

  if (variant === 'chip') {
    // No subline here, so personal is named as "Personal", not the reader's name.
    const chipName = workspace.kind === 'personal' ? personal : current.name;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-workspace-switcher
            data-workspace-chip
            aria-label={
              workspace.kind === 'resolving'
                ? t('web.workspace.switchTo')
                : t('web.workspace.current', { name: chipName })
            }
            className="text-foreground inset-ring-hairline shrink-0 gap-1.5 rounded-full inset-ring-1 has-[>svg]:pr-2.5 has-[>svg]:pl-1.5 md:hidden"
          >
            {workspace.kind === 'team' ? (
              <WorkspaceTile kind="team" name={workspace.team.name} size="sm" />
            ) : workspace.kind === 'personal' ? (
              <WorkspaceTile kind="personal" name={personalTileName} size="sm" />
            ) : (
              <span aria-hidden className="bg-muted size-5 shrink-0 rounded-md" />
            )}
            {/* Below `sm` the name goes: the page title and its actions share a 375px
                bar with this chip, and a named chip squeezed the title to nothing. The
                tile still says which workspace, and the accessible name says it in full. */}
            <span className="text-body max-w-32 truncate max-sm:hidden">{chipName}</span>
            <ChevronsUpDown aria-hidden className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <WorkspaceMenu align="end" personalTileName={personalTileName} />
      </DropdownMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={current.name}
              data-workspace-switcher
              aria-label={
                workspace.kind === 'resolving'
                  ? t('web.workspace.switchTo')
                  : t('web.workspace.current', { name: current.name })
              }
              className="data-[state=open]:bg-sidebar-accent"
            >
              {/* The rail is 32px wide; centre the 24px tile in it. */}
              <span className="flex size-8 shrink-0 items-center justify-center">
                {current.tile}
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
                <span className="text-body truncate font-medium">{current.name}</span>
                {current.subline ? (
                  <span className="text-hint text-muted-foreground truncate">
                    {current.subline}
                  </span>
                ) : null}
              </span>
              <ChevronsUpDown aria-hidden className="text-muted-foreground ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <WorkspaceMenu align="start" personalTileName={personalTileName} wide />
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** The menu both triggers open: where you can be, then create and manage. */
function WorkspaceMenu({
  align,
  personalTileName,
  wide = false,
}: {
  align: 'start' | 'end';
  personalTileName: string;
  /** As wide as the sidebar trigger, which is wider than the chip. */
  wide?: boolean;
}) {
  const t = useTranslate();
  const { workspace, teams, teamsStatus, select, reloadTeams } = useWorkspace();
  // No item is checked while the workspace resolves: ticking Personal there would
  // claim a choice that may turn out to be a team a moment later.
  const active =
    workspace.kind === 'team' ? workspace.team.id : workspace.kind === 'personal' ? 'personal' : '';

  return (
    <DropdownMenuContent
      align={align}
      className={cn(
        'max-w-[calc(100vw-2rem)]',
        wide ? 'w-(--radix-dropdown-menu-trigger-width) min-w-64' : 'w-64',
      )}
    >
      <DropdownMenuLabel>{t('web.workspace.label')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={active} onValueChange={select}>
        <DropdownMenuRadioItem value="personal" data-workspace-option="personal" className="gap-2">
          <WorkspaceTile kind="personal" name={personalTileName} size="sm" />
          <span className="min-w-0 flex-1 truncate">{t('web.workspace.personal')}</span>
        </DropdownMenuRadioItem>
        {teams.map((team) => (
          <DropdownMenuRadioItem
            key={team.id}
            value={team.id}
            data-workspace-option={team.id}
            className="gap-2"
          >
            <WorkspaceTile kind="team" name={team.name} size="sm" />
            <span data-workspace-option-name className="min-w-0 flex-1 break-words line-clamp-2">
              {team.name}
            </span>
            <span className="text-hint text-muted-foreground shrink-0">
              {t(ROLE_KEY[team.role])}
            </span>
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
      <DropdownMenuItem
        data-workspace-create
        onSelect={() => {
          // The create form lives in the personal view of Settings › Team.
          if (workspace.kind === 'team') select('personal');
          requestTeamCreateForm();
          openSettingsDialog('team');
        }}
      >
        {t('web.workspace.createTeam')}
      </DropdownMenuItem>
      <DropdownMenuItem data-workspace-manage onSelect={() => openSettingsDialog('team')}>
        {workspace.kind === 'team' ? t('web.workspace.manageTeam') : t('web.workspace.manageTeams')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

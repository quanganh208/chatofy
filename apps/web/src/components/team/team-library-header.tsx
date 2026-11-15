'use client';

import type { TeamSummary } from '@chatofy/types';
import { WorkspaceTile } from '@/components/workspace/workspace-tile';
import { useTranslate } from '@/i18n/provider';
import { cn } from '@/lib/utils';

/**
 * The line that says a library is a team's: the team's tile, an optional label
 * ("Team glossaries"), and one muted line on who shares it and what the reader may
 * change. A readout on the page ground — no card, no accent.
 *
 * The edit clause follows the API's rule (`canEditRow`): an owner or admin edits
 * every team row, a member only the rows they authored.
 *
 * `data-library-note` marks it for the specs and the accent gate, which find the
 * team's list as the element after it.
 */
export function TeamLibraryHeader({
  team,
  label,
  className,
}: {
  team: TeamSummary;
  /** Omitted where a heading above already names the library. */
  label?: string;
  className?: string;
}) {
  const t = useTranslate();
  const shared =
    team.memberCount > 1
      ? t('web.workspace.sharedWith', { count: team.memberCount, name: team.name })
      : t('web.workspace.sharedWithOnlyYou', { name: team.name });
  const edits = t(team.role === 'member' ? 'web.workspace.editOwn' : 'web.workspace.editAll');

  return (
    <div data-library-note className={cn('flex min-w-0 items-center gap-3', className)}>
      <WorkspaceTile kind="team" name={team.name} size="md" />
      <div className="flex min-w-0 flex-col">
        {label ? <h2 className="text-body font-medium">{label}</h2> : null}
        <span className="text-hint text-muted-foreground break-words">
          {shared} · {edits}
        </span>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@chatofy/ui/react';
import { GLOSSARY_LIMITS } from '@chatofy/types';
import type { SaveGlossaryRequest } from '@chatofy/types';
import { TopbarActions } from '@/components/layout/chrome-slots';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { useGlossaries } from '@/hooks/use-glossaries';
import { useTranslate } from '@/i18n/provider';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { GlossaryCreateDialog } from './glossary-create-dialog';
import { GlossaryDetailPanel } from './glossary-detail-panel';
import { GlossaryListPanel } from './glossary-list-panel';

/**
 * Glossaries as History is laid out: the list on the left, the open glossary on the
 * right, a hairline between them, both on the page ground — no box around either.
 *
 * With nothing to open it is the list alone, at full width. Below `md` it is one
 * column at a time, as History is two pages: the list, or —
 * once a glossary is chosen — that glossary with a way back. From a 48rem CONTENT
 * width (`@3xl`, measured on this element, not the viewport, so an open sidebar
 * counts) both panes show and the list stays in view while a long term list
 * scrolls. Keyed to the viewport's `md`, a 768px tablet with the sidebar open had
 * 464px for 288px of list plus the detail's controls, and the page scrolled sideways.
 *
 * New glossary sits in the topbar and opens a dialog. Selection is local UI state;
 * the glossaries themselves are the shared provider's.
 *
 * ## Scope
 *
 * The list is the active workspace's library. In a team it opens with one muted
 * line naming the team, and a glossary the reader may not edit opens view-only.
 * Every write passes the scope of the render that made it — a dialog, a toast's
 * Undo or Retry — so a switch while one is pending cannot land it in the other
 * library. A selection is kept with its scope: a switch hides it, and switching
 * back shows it again only if the glossary is still listed there.
 *
 * ## The accent budget
 *
 * None spent on the screen itself: New glossary and Add term are outline. An open
 * dialog's submit is then the one accent-filled control, and the dialog the one
 * elevated surface (two while its language list is open).
 */
export function GlossaryPageContent() {
  const t = useTranslate();
  const { glossaries, status, teamId, save, patch, remove, retry, reload } = useGlossaries();
  const { workspace } = useWorkspace();
  const teamName = teamId !== undefined && workspace.kind === 'team' ? workspace.team.name : null;
  const [selection, setSelection] = useState<{ id: string; teamId: string | undefined } | null>(
    null,
  );
  const selectedId = selection !== null && selection.teamId === teamId ? selection.id : null;
  const setSelectedId = (id: string | null) => setSelection(id === null ? null : { id, teamId });
  // The scope New glossary was opened in; the dialog saves there even after a switch.
  const [creating, setCreating] = useState<{ teamId: string | undefined } | null>(null);

  const selected = glossaries.find((g) => g.id === selectedId) ?? null;
  const atLimit = glossaries.length >= GLOSSARY_LIMITS.MAX_GLOSSARIES_PER_OWNER;
  // Nothing to open — none stored, or the list failed: one column, as History is
  // with nothing stored, rather than a pane that says "select one" beside nothing.
  const solo = status === 'failed' || (status === 'ready' && glossaries.length === 0);

  const create = async (body: SaveGlossaryRequest) => {
    const id = crypto.randomUUID();
    const scope = creating?.teamId;
    await save(id, body, scope);
    setCreating(null);
    setSelection({ id, teamId: scope });
    notify.success(t('web.glossary.created', { name: body.name }));
  };

  const setActive = (
    glossaryId: string,
    active: boolean,
    name: string,
    scope: string | undefined,
  ) => {
    patch(glossaryId, { isActive: active }, scope).then(
      () =>
        notify.success(
          active ? t('web.glossary.turnedOn', { name }) : t('web.glossary.turnedOff', { name }),
          {
            id: `glossary-active-${glossaryId}`,
            undo: () => setActive(glossaryId, !active, name, scope),
          },
        ),
      () =>
        notify.error(t('web.glossary.toggleFailed', { name }), {
          id: `glossary-active-${glossaryId}`,
          retry: () => setActive(glossaryId, active, name, scope),
        }),
    );
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const { id, name } = selected;
    await remove(id, teamId);
    setSelectedId(null);
    notify.success(t('web.glossary.deleted', { name }));
  };

  return (
    <>
      {status === 'ready' && !atLimit ? (
        <TopbarActions>
          <Button variant="outline" size="sm" onClick={() => setCreating({ teamId })}>
            <Plus aria-hidden />
            {t('web.glossary.new')}
          </Button>
        </TopbarActions>
      ) : null}

      {teamName !== null ? (
        <p data-library-note className="text-hint text-muted-foreground">
          {t('web.workspace.libraryNote', { name: teamName })}
        </p>
      ) : null}
      <div className="@container">
        <div className="flex flex-col @3xl:flex-row @3xl:items-start">
          <GlossaryListPanel
            glossaries={glossaries}
            status={status}
            onRetry={() => void retry()}
            selectedId={selectedId}
            onSelect={setSelectedId}
            className={cn(
              solo ? 'w-full' : 'w-full @3xl:sticky @3xl:top-4 @3xl:w-72 @3xl:shrink-0 @3xl:pr-4',
              selected ? '@max-3xl:hidden' : undefined,
            )}
          />
          {solo ? null : (
            <>
              <div aria-hidden className="bg-hairline hidden w-px self-stretch @3xl:block" />
              <GlossaryDetailPanel
                key={selected?.id ?? 'none'}
                glossary={selected}
                teamId={teamId}
                onListStale={() => void reload()}
                onBack={() => setSelectedId(null)}
                onToggleActive={(active) =>
                  selected && setActive(selected.id, active, selected.name, teamId)
                }
                onDelete={deleteSelected}
                className={cn('min-w-0 flex-1 @3xl:pl-8', selected ? undefined : '@max-3xl:hidden')}
              />
            </>
          )}
        </div>
      </div>

      <GlossaryCreateDialog
        open={creating !== null}
        onOpenChange={(open) => setCreating(open ? { teamId } : null)}
        onCreate={create}
      />
    </>
  );
}

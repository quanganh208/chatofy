'use client';

import { useEffect, useMemo, useState } from 'react';
import type { TranslationContext } from '@chatofy/types';
import { listAvailableTranslationContexts } from '@/clients/api-client';
import { useTranslate } from '@/i18n/provider';
import { onLibraryChanged } from '@/lib/library-changed';
import type { TranslationContextsState } from '@/hooks/use-translation-contexts';

/** One scope's contexts as the picker draws them. `label: null` renders flat. */
export interface ContextGroup {
  key: string;
  label: string | null;
  contexts: TranslationContext[];
}

/** What `GET /translation-contexts/available` reads to, after the entry-by-entry parse. */
export interface AvailableContexts {
  personal: TranslationContext[];
  teams: { teamId: string; name: string; contexts: TranslationContext[] }[];
}

/**
 * The picker's groups, and every context it may resolve a stored id against.
 *
 * Resolution rule: an id names the personal context if there is one; otherwise
 * the team context only when EXACTLY ONE team holds it. An id two teams hold can
 * only come from a create race the API otherwise refuses, and resolving it by
 * team order would let a teammate plant a context under an id another member
 * selected — so it appears in no group and not in `all`, and resolves to none.
 *
 * A reader in no team sees one group, and it renders flat (label null) so the
 * picker's DOM is what it was before teams existed. Only the personal group is
 * flattened: a sole TEAM group keeps its label, or the reader could not tell
 * whose contexts they are picking from.
 */
export function groupAvailable(
  available: AvailableContexts,
  personalLabel: string,
): { groups: ContextGroup[]; all: TranslationContext[] } {
  const personalIds = new Set(available.personal.map((context) => context.id));
  const teamCounts = new Map<string, number>();
  for (const team of available.teams) {
    for (const context of team.contexts) {
      if (personalIds.has(context.id)) continue;
      teamCounts.set(context.id, (teamCounts.get(context.id) ?? 0) + 1);
    }
  }

  const groups: ContextGroup[] = [
    { key: 'personal', label: personalLabel, contexts: available.personal },
    ...available.teams.map((team) => ({
      key: team.teamId,
      label: team.name,
      contexts: team.contexts.filter(
        (context) => !personalIds.has(context.id) && teamCounts.get(context.id) === 1,
      ),
    })),
  ].filter((group) => group.contexts.length > 0);

  const [sole] = groups;
  if (groups.length === 1 && sole?.key === 'personal') groups[0] = { ...sole, label: null };

  return { groups, all: groups.flatMap((group) => group.contexts) };
}

/** What {@link useAvailableTranslationContexts} hands back. */
export interface AvailableTranslationContextsValue {
  groups: ContextGroup[];
  all: TranslationContext[];
  status: TranslationContextsState;
}

/**
 * Every context the reader may translate under, grouped by scope.
 *
 * Deliberately NOT tied to the active workspace: the workspace decides which
 * library the editors manage, never which contexts a session may use. Fetches
 * once per mount, and again after any library write in this tab, so an edit in
 * Settings over `/translate` reaches the picker. A refetch that fails keeps the
 * list it had: the picker must not vanish because one background read did.
 */
export function useAvailableTranslationContexts(): AvailableTranslationContextsValue {
  const t = useTranslate();
  const personalLabel = t('web.workspace.personal');
  const [available, setAvailable] = useState<AvailableContexts | null>(null);
  const [status, setStatus] = useState<TranslationContextsState>('loading');

  useEffect(() => {
    let generation = 0;
    // Whether any read has landed. A failure before that is the list's answer, even
    // when it comes from a refetch that superseded the first read; after it, a failed
    // refetch keeps the list that is on screen.
    let settled = false;
    const fetchAvailable = () => {
      const mine = ++generation;
      listAvailableTranslationContexts().then(
        (result) => {
          if (mine !== generation) return;
          settled = true;
          setAvailable(result);
          setStatus('ready');
        },
        () => {
          if (mine !== generation || settled) return;
          setAvailable(null);
          setStatus('failed');
        },
      );
    };
    fetchAvailable();
    const unsubscribe = onLibraryChanged(fetchAvailable);
    return () => {
      generation += 1;
      unsubscribe();
    };
  }, []);

  const grouped = useMemo(
    () => (available ? groupAvailable(available, personalLabel) : { groups: [], all: [] }),
    [available, personalLabel],
  );

  return { ...grouped, status };
}

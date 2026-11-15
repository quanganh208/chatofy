'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { notifyLibraryChanged } from '@/lib/library-changed';
import { teamListIsStale } from './use-team-list';

export type ScopedLibraryStatus = 'loading' | 'ready' | 'failed';

/** One finished read, kept with the scope it was for (`undefined` is personal). */
interface Loaded<T> {
  teamId: string | undefined;
  rows: T[];
  status: 'ready' | 'failed';
}

/**
 * A library list (glossaries, AI Contexts) for the active workspace.
 *
 * - **Follows the workspace.** The list is the personal library or the active team's,
 *   and refetches when the workspace changes. While the workspace resolves, nothing is
 *   fetched: the status is `failed` if the team list failed and `loading` otherwise,
 *   and Retry reloads the teams, because that is what is missing.
 * - **Drops stale replies.** Every fetch takes a number from a generation counter that
 *   also moves when the scope changes, and a reply whose number is not current is
 *   dropped. A read is also kept with the scope it was for, so between a switch and
 *   the new reply the old scope's rows are never shown under the new scope.
 * - **Writes carry their own scope.** `write(teamId, op)` runs a write the caller
 *   aimed at the scope it captured, then reloads the LIVE scope's list. A 403 or 404
 *   from a team write reloads the teams and the list (the role or the row changed),
 *   then rethrows so the caller's failure copy still shows. A write that lands tells
 *   the translate picker to refetch (`lib/library-changed.ts`).
 *
 * `fetchRows` must be stable (a module function or a `useCallback`), and effect
 * dependencies stay primitive (`teamId`, `resolving`), never the workspace object.
 */
export function useScopedLibrary<T>(
  enabled: boolean,
  fetchRows: (teamId: string | undefined) => Promise<T[]>,
) {
  const { workspace, teamsStatus, reloadTeams } = useWorkspace();
  const teamId = workspace.kind === 'team' ? workspace.team.id : undefined;
  const resolving = workspace.kind === 'resolving';
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const generation = useRef(0);
  // The scope on screen, for a reload that a write or a toast started in another one.
  const live = useRef<{ teamId: string | undefined; resolving: boolean }>({ teamId, resolving });

  useEffect(() => {
    live.current = { teamId, resolving };
  }, [teamId, resolving]);

  const fetchFor = useCallback(
    (scope: string | undefined) => {
      const mine = ++generation.current;
      return fetchRows(scope).then(
        (rows) => {
          if (mine === generation.current) setLoaded({ teamId: scope, rows, status: 'ready' });
        },
        (err: unknown) => {
          if (mine !== generation.current) return;
          if (scope !== undefined && teamListIsStale(err)) void reloadTeams();
          setLoaded({ teamId: scope, rows: [], status: 'failed' });
        },
      );
    },
    [fetchRows, reloadTeams],
  );

  useEffect(() => {
    if (!enabled || resolving) return;
    void fetchFor(teamId);
    return () => {
      generation.current += 1;
    };
  }, [enabled, resolving, teamId, fetchFor]);

  /** Load the scope on screen again; nothing while the workspace resolves. */
  const reload = useCallback(async () => {
    if (live.current.resolving) return;
    await fetchFor(live.current.teamId);
  }, [fetchFor]);

  const write = useCallback(
    async (scope: string | undefined, op: () => Promise<unknown>) => {
      try {
        await op();
      } catch (err) {
        if (scope !== undefined && teamListIsStale(err)) {
          void reloadTeams();
          void reload();
        }
        throw err;
      }
      notifyLibraryChanged();
      await reload();
    },
    [reload, reloadTeams],
  );

  /** After a failure: reload the teams while resolving, else show loading and refetch. */
  const retry = useCallback(async () => {
    if (live.current.resolving) {
      await reloadTeams();
      return;
    }
    setLoaded(null);
    await reload();
  }, [reload, reloadTeams]);

  const current = !resolving && loaded?.teamId === teamId ? loaded : null;
  const status: ScopedLibraryStatus = resolving
    ? teamsStatus === 'failed'
      ? 'failed'
      : 'loading'
    : (current?.status ?? 'loading');

  return {
    /** The scope the rows belong to: `undefined` is personal. */
    teamId,
    rows: current?.rows ?? EMPTY,
    status,
    write,
    retry,
  };
}

const EMPTY: never[] = [];

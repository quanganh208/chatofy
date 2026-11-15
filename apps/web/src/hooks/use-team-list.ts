'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@chatofy/api-client';
import { useWorkspace } from '@/components/workspace/workspace-provider';

export type TeamListStatus = 'loading' | 'ready' | 'failed';

/** True for a 404: the team is gone or the caller left it, so the team list is stale. */
export function isTeamGone(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 404;
}

/**
 * True when the team list no longer describes the caller: a 404 (the team is gone)
 * or a 403 (their role changed, e.g. an admin demoted while the tab was open). Either
 * way the teams reload, and the view redraws for the role the caller now holds.
 */
function teamListIsStale(err: unknown): boolean {
  return isTeamGone(err) || (err instanceof ApiClientError && err.status === 403);
}

/**
 * One list that belongs to one team (its members, its invites), loaded for the team
 * on screen and nothing else.
 *
 * Every fetch takes a number from a generation counter that also moves when the team
 * changes, and a response whose number is not the current one is dropped: switching
 * teams mid-request must never paint the previous team's rows under the new name.
 * A 404 or 403 means the team list itself is stale, so it reloads the teams: the
 * workspace falls back to personal if the team is gone, and a demoted admin's view
 * loses the controls their new role does not have.
 */
export function useTeamList<T>(
  teamId: string,
  enabled: boolean,
  fetchRows: (teamId: string) => Promise<T[]>,
) {
  const { reloadTeams } = useWorkspace();
  const [state, setState] = useState<{ teamId: string; rows: T[]; status: TeamListStatus }>({
    teamId,
    rows: [],
    status: 'loading',
  });
  const generation = useRef(0);

  // Fetch and settle as one promise chain, so no state is set synchronously in the
  // effect below; a response from an older generation is dropped.
  const fetchAndSettle = useCallback(() => {
    const mine = ++generation.current;
    return fetchRows(teamId).then(
      (rows) => {
        if (mine === generation.current) setState({ teamId, rows, status: 'ready' });
      },
      (err: unknown) => {
        if (mine !== generation.current) return;
        if (teamListIsStale(err)) void reloadTeams();
        setState((prev) => ({
          teamId,
          rows: prev.teamId === teamId ? prev.rows : [],
          status: 'failed',
        }));
      },
    );
  }, [teamId, fetchRows, reloadTeams]);
  const load = fetchAndSettle;

  useEffect(() => {
    if (!enabled) return;
    void fetchAndSettle();
    return () => {
      generation.current += 1;
    };
  }, [enabled, fetchAndSettle]);

  /** Run a write, then reload; a 404 or 403 sends the workspace back through `reloadTeams`. */
  const mutate = useCallback(
    async (write: () => Promise<unknown>) => {
      try {
        await write();
      } catch (err) {
        if (teamListIsStale(err)) void reloadTeams();
        throw err;
      }
      await load();
    },
    [load, reloadTeams],
  );

  const current = state.teamId === teamId;
  return {
    rows: current ? state.rows : [],
    status: current ? state.status : ('loading' as TeamListStatus),
    retry: load,
    mutate,
  };
}

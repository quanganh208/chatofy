'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useSession } from 'next-auth/react';
import type { TeamSummary } from '@chatofy/types';
import { listTeams } from '@/clients/teams-api-client';
import {
  readStoredWorkspace,
  subscribeStoredWorkspace,
  writeStoredWorkspace,
} from '@/lib/workspace-store';

export type Workspace =
  { kind: 'personal' } | { kind: 'team'; team: TeamSummary } | { kind: 'resolving' };

export type TeamsStatus = 'loading' | 'ready' | 'failed';

export interface WorkspaceValue {
  workspace: Workspace;
  teams: TeamSummary[];
  teamsStatus: TeamsStatus;
  /** `'personal'` or a team id. */
  select: (id: string) => void;
  reloadTeams: () => Promise<void>;
}

/**
 * Outside the provider every screen is personal, which is what every screen was
 * before teams existed, so a spec that never mounts the provider sees no change.
 */
const PERSONAL_DEFAULT: WorkspaceValue = {
  workspace: { kind: 'personal' },
  teams: [],
  teamsStatus: 'ready',
  select: () => {},
  reloadTeams: async () => {},
};

const WorkspaceContext = createContext<WorkspaceValue>(PERSONAL_DEFAULT);

export function useWorkspace(): WorkspaceValue {
  return useContext(WorkspaceContext);
}

/** Teams as loaded for ONE user: another user's list never answers for this one. */
interface LoadedTeams {
  userId: string;
  teams: TeamSummary[];
  status: TeamsStatus;
  /** A list has loaded for this user and nothing has failed since. */
  settled: boolean;
}

const personalSnapshot = () => 'personal';

/**
 * Resolves which workspace this tab manages: personal, a team, or `resolving`.
 *
 * The rules that keep writes out of the wrong scope:
 * - nothing resolves while the session or the team list is still loading;
 * - a FAILED team list resolves to `resolving` and never rewrites the stored choice,
 *   so a network blip cannot silently move someone back to personal;
 * - only a successful list that lacks the stored team falls back to personal and
 *   records that;
 * - other tabs are not followed live (see `workspace-store.ts`).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, status } = useSession();
  const userId = data?.user?.id;
  const [loaded, setLoaded] = useState<LoadedTeams | null>(null);
  const generation = useRef(0);

  const fetchTeams = useCallback((forUser: string) => {
    const mine = ++generation.current;
    return listTeams().then(
      ({ teams }) => {
        if (mine === generation.current)
          setLoaded({ userId: forUser, teams, status: 'ready', settled: true });
      },
      () => {
        if (mine !== generation.current) return;
        // Keep the last good list: a failed reload must not empty the switcher.
        setLoaded((prev) => ({
          userId: forUser,
          teams: prev?.userId === forUser ? prev.teams : [],
          status: 'failed',
          settled: false,
        }));
      },
    );
  }, []);

  useEffect(() => {
    if (!userId) return;
    void fetchTeams(userId);
    return () => {
      generation.current += 1;
    };
  }, [userId, fetchTeams]);

  const reloadTeams = useCallback(async () => {
    if (!userId) return;
    setLoaded((prev) =>
      prev?.userId === userId
        ? { ...prev, status: 'loading' }
        : { userId, teams: [], status: 'loading', settled: false },
    );
    await fetchTeams(userId);
  }, [userId, fetchTeams]);

  const stored = useSyncExternalStore(
    subscribeStoredWorkspace,
    () => (userId ? readStoredWorkspace(userId) : 'personal'),
    personalSnapshot,
  );

  const mine = loaded?.userId === userId ? loaded : null;
  const teams = useMemo(() => mine?.teams ?? [], [mine]);
  const teamsStatus: TeamsStatus = mine?.status ?? 'loading';
  const settled = mine?.settled ?? false;

  const select = useCallback(
    (id: string) => {
      if (userId) writeStoredWorkspace(userId, id);
    },
    [userId],
  );

  const workspace = useMemo<Workspace>(() => {
    if (status === 'loading') return { kind: 'resolving' };
    if (status === 'unauthenticated' || !userId) return { kind: 'personal' };
    if (stored === 'personal') return { kind: 'personal' };
    // A reload keeps answering from the last good list, so a rename or a create does
    // not unmount whatever the team's screens have open. A first load, or a failure,
    // has no list to answer from.
    const usable = teamsStatus === 'ready' || (teamsStatus === 'loading' && settled);
    if (!usable) return { kind: 'resolving' };
    const team = teams.find((t) => t.id === stored);
    if (team) return { kind: 'team', team };
    return teamsStatus === 'ready' ? { kind: 'personal' } : { kind: 'resolving' };
  }, [status, userId, stored, teamsStatus, settled, teams]);

  // The stored team is gone (left, removed or deleted) per a list that DID load.
  const storedIsGone =
    !!userId &&
    stored !== 'personal' &&
    teamsStatus === 'ready' &&
    !teams.some((t) => t.id === stored);
  useEffect(() => {
    if (storedIsGone) select('personal');
  }, [storedIsGone, select]);

  const value = useMemo<WorkspaceValue>(
    () => ({ workspace, teams, teamsStatus, select, reloadTeams }),
    [workspace, teams, teamsStatus, select, reloadTeams],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

/** A fixed value, for specs only, the way `ChromeSlotsTestHost` stands in for its provider. */
export function WorkspaceTestHost({
  value,
  children,
}: {
  value: Partial<WorkspaceValue>;
  children: ReactNode;
}) {
  return (
    <WorkspaceContext.Provider value={{ ...PERSONAL_DEFAULT, ...value }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

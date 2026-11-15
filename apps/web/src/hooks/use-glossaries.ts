'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react';
import { deleteGlossary, listGlossaries, patchGlossary, saveGlossary } from '@/clients/api-client';
import type { Glossary, PatchGlossaryRequest, SaveGlossaryRequest } from '@chatofy/types';
import { useScopedLibrary } from './use-scoped-library';

export type GlossariesState = 'loading' | 'ready' | 'failed';

export interface GlossariesValue {
  glossaries: Glossary[];
  status: GlossariesState;
  /** The scope the rows belong to: `undefined` is personal, else the team's id. */
  teamId: string | undefined;
  /**
   * Writes take the scope they are aimed at, captured when their editor or toast was
   * made (pass `teamId` from that render), never the live workspace: a switch while a
   * dialog or an undo is pending must not land the write in the other library.
   */
  save: (
    glossaryId: string,
    body: SaveGlossaryRequest,
    teamId: string | undefined,
  ) => Promise<void>;
  patch: (
    glossaryId: string,
    body: PatchGlossaryRequest,
    teamId: string | undefined,
  ) => Promise<void>;
  remove: (glossaryId: string, teamId: string | undefined) => Promise<void>;
  /** Load again after a failure, showing the loading state while it runs. */
  retry: () => Promise<void>;
  /** Refetch in the background, e.g. after a refused term write changed `canEdit`. */
  reload: () => Promise<void>;
}

const SharedGlossaries = createContext<GlossariesValue | null>(null);

/** Team rows carry `canEdit`; a personal row is always the caller's own. */
const fetchGlossaries = (teamId: string | undefined) =>
  listGlossaries(teamId).then((result) =>
    result.glossaries.map((glossary) => ({ ...glossary, canEdit: glossary.canEdit ?? true })),
  );

/** The active workspace's glossaries (`use-scoped-library.ts` holds the scope rules). */
function useOwnGlossaries(enabled: boolean): GlossariesValue {
  const { teamId, rows, status, write, retry, reload } = useScopedLibrary(enabled, fetchGlossaries);

  const save = useCallback(
    (glossaryId: string, body: SaveGlossaryRequest, scope: string | undefined) =>
      write(scope, () => saveGlossary(glossaryId, body, scope)),
    [write],
  );
  const patch = useCallback(
    (glossaryId: string, body: PatchGlossaryRequest, scope: string | undefined) =>
      write(scope, () => patchGlossary(glossaryId, body, scope)),
    [write],
  );
  const remove = useCallback(
    (glossaryId: string, scope: string | undefined) =>
      write(scope, () => deleteGlossary(glossaryId, scope)),
    [write],
  );

  return { glossaries: rows, status, teamId, save, patch, remove, retry, reload };
}

export function GlossariesProvider({ children }: { children: ReactNode }): ReactElement {
  const value = useOwnGlossaries(true);
  return createElement(SharedGlossaries.Provider, { value }, children);
}

export function useGlossaries(): GlossariesValue {
  const shared = useContext(SharedGlossaries);
  const own = useOwnGlossaries(shared === null);
  return shared ?? own;
}

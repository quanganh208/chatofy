'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addGlossaryItem, deleteGlossaryItem, listGlossaryItems } from '@/clients/api-client';
import type { GlossaryItem, SaveGlossaryItemRequest } from '@chatofy/types';
import { useWorkspace } from '@/components/workspace/workspace-provider';
import { notifyLibraryChanged } from '@/lib/library-changed';
import { teamListIsStale } from './use-team-list';

export type GlossaryItemsState = 'idle' | 'loading' | 'ready' | 'failed';

export interface GlossaryItemsValue {
  items: GlossaryItem[];
  status: GlossaryItemsState;
  /** Writes take the scope of the glossary they were opened on, never the live one. */
  addItem: (body: SaveGlossaryItemRequest, teamId: string | undefined) => Promise<void>;
  removeItem: (itemId: string, teamId: string | undefined) => Promise<void>;
}

/** One finished read, kept with the glossary and the scope it was for. */
interface LoadedItems {
  key: string;
  items: GlossaryItem[];
  status: 'ready' | 'failed';
}

const NO_ITEMS: GlossaryItem[] = [];
const keyOf = (glossaryId: string, teamId: string | undefined) => `${teamId ?? ''}/${glossaryId}`;

/**
 * Items for the currently selected glossary, in the scope its list came from.
 *
 * Pass `glossaryId = null` when no glossary is selected: the hook returns idle state
 * and makes no network request. `teamId` is the scope the glossary LIST belongs to
 * (`useGlossaries().teamId`), not the live workspace, so the items always come from
 * the library the glossary was listed in.
 *
 * `idle` and `loading` are derived rather than stored: a read is kept with the
 * glossary and scope it was for, and a selection whose read has not landed yet is
 * loading. A reply for a glossary that is no longer selected — a slow reload after
 * the user moved on — is dropped instead of painting the wrong list. A 403 or 404
 * from a team write reloads the teams and the items, then rethrows.
 */
export function useGlossaryItems(
  glossaryId: string | null,
  teamId: string | undefined,
): GlossaryItemsValue {
  const { reloadTeams } = useWorkspace();
  const [loaded, setLoaded] = useState<LoadedItems | null>(null);
  const key = glossaryId === null ? null : keyOf(glossaryId, teamId);
  const selected = useRef(key);

  useEffect(() => {
    selected.current = key;
  }, [key]);

  const load = useCallback(async (id: string, scope: string | undefined) => {
    const forKey = keyOf(id, scope);
    let next: LoadedItems;
    try {
      const result = await listGlossaryItems(id, scope);
      next = { key: forKey, items: result.items, status: 'ready' };
    } catch {
      next = { key: forKey, items: [], status: 'failed' };
    }
    if (selected.current === forKey) setLoaded(next);
  }, []);

  useEffect(() => {
    if (glossaryId !== null) void load(glossaryId, teamId);
  }, [glossaryId, teamId, load]);

  const reload = useCallback(async () => {
    if (glossaryId !== null) await load(glossaryId, teamId);
  }, [glossaryId, teamId, load]);

  const current = key !== null && loaded?.key === key ? loaded : null;
  const items = current?.items ?? NO_ITEMS;
  const status: GlossaryItemsState = glossaryId === null ? 'idle' : (current?.status ?? 'loading');

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

  const addItem = useCallback(
    async (body: SaveGlossaryItemRequest, scope: string | undefined) => {
      if (glossaryId === null) return;
      await write(scope, () => addGlossaryItem(glossaryId, body, scope));
    },
    [glossaryId, write],
  );

  const removeItem = useCallback(
    async (itemId: string, scope: string | undefined) => {
      if (glossaryId === null) return;
      await write(scope, () => deleteGlossaryItem(glossaryId, itemId, scope));
    },
    [glossaryId, write],
  );

  return { items, status, addItem, removeItem };
}

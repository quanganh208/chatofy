'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { addGlossaryItem, deleteGlossaryItem, listGlossaryItems } from '@/clients/api-client';
import type { GlossaryItem, SaveGlossaryItemRequest } from '@chatofy/types';

export type GlossaryItemsState = 'idle' | 'loading' | 'ready' | 'failed';

export interface GlossaryItemsValue {
  items: GlossaryItem[];
  status: GlossaryItemsState;
  addItem: (body: SaveGlossaryItemRequest) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

/** One finished read, kept with the glossary it was for. */
interface LoadedItems {
  glossaryId: string;
  items: GlossaryItem[];
  status: 'ready' | 'failed';
}

const NO_ITEMS: GlossaryItem[] = [];

/**
 * Items for the currently selected glossary.
 *
 * Pass `glossaryId = null` when no glossary is selected — the hook returns
 * idle state and makes no network request.
 *
 * `idle` and `loading` are derived rather than stored: a read is kept with the
 * glossary it was for, and a selection whose read has not landed yet is
 * loading. The effect then only ever sets state once a request settles, and a
 * reply for a glossary that is no longer selected — a slow reload after the
 * user moved on — is dropped instead of painting the wrong list.
 */
export function useGlossaryItems(glossaryId: string | null): GlossaryItemsValue {
  const [loaded, setLoaded] = useState<LoadedItems | null>(null);
  const selected = useRef(glossaryId);

  useEffect(() => {
    selected.current = glossaryId;
  }, [glossaryId]);

  const load = useCallback(async (id: string) => {
    let next: LoadedItems;
    try {
      const result = await listGlossaryItems(id);
      next = { glossaryId: id, items: result.items, status: 'ready' };
    } catch {
      next = { glossaryId: id, items: [], status: 'failed' };
    }
    if (selected.current === id) setLoaded(next);
  }, []);

  useEffect(() => {
    if (glossaryId !== null) void load(glossaryId);
  }, [glossaryId, load]);

  const reload = useCallback(async () => {
    if (glossaryId !== null) await load(glossaryId);
  }, [glossaryId, load]);

  const current = glossaryId !== null && loaded?.glossaryId === glossaryId ? loaded : null;
  const items = current?.items ?? NO_ITEMS;
  const status: GlossaryItemsState = glossaryId === null ? 'idle' : (current?.status ?? 'loading');

  const addItem = useCallback(
    async (body: SaveGlossaryItemRequest) => {
      if (glossaryId === null) return;
      await addGlossaryItem(glossaryId, body);
      await reload();
    },
    [glossaryId, reload],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      if (glossaryId === null) return;
      await deleteGlossaryItem(glossaryId, itemId);
      await reload();
    },
    [glossaryId, reload],
  );

  return { items, status, addItem, removeItem };
}

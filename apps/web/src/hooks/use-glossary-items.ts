'use client';

import { useCallback, useEffect, useState } from 'react';
import { addGlossaryItem, deleteGlossaryItem, listGlossaryItems } from '@/clients/api-client';
import type { GlossaryItem, SaveGlossaryItemRequest } from '@chatofy/types';

export type GlossaryItemsState = 'idle' | 'loading' | 'ready' | 'failed';

export interface GlossaryItemsValue {
  items: GlossaryItem[];
  status: GlossaryItemsState;
  addItem: (body: SaveGlossaryItemRequest) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

/**
 * Items for the currently selected glossary.
 *
 * Pass `glossaryId = null` when no glossary is selected — the hook returns
 * idle state and makes no network request.
 */
export function useGlossaryItems(glossaryId: string | null): GlossaryItemsValue {
  const [items, setItems] = useState<GlossaryItem[]>([]);
  const [status, setStatus] = useState<GlossaryItemsState>('idle');

  const reload = useCallback(async () => {
    if (glossaryId === null) return;
    try {
      const result = await listGlossaryItems(glossaryId);
      setItems(result.items);
      setStatus('ready');
    } catch {
      setItems([]);
      setStatus('failed');
    }
  }, [glossaryId]);

  useEffect(() => {
    if (glossaryId === null) {
      setItems([]);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    listGlossaryItems(glossaryId)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [glossaryId]);

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

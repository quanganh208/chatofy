'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { deleteGlossary, listGlossaries, patchGlossary, saveGlossary } from '@/clients/api-client';
import type { Glossary, PatchGlossaryRequest, SaveGlossaryRequest } from '@chatofy/types';

export type GlossariesState = 'loading' | 'ready' | 'failed';

export interface GlossariesValue {
  glossaries: Glossary[];
  status: GlossariesState;
  save: (glossaryId: string, body: SaveGlossaryRequest) => Promise<void>;
  patch: (glossaryId: string, body: PatchGlossaryRequest) => Promise<void>;
  remove: (glossaryId: string) => Promise<void>;
}

const SharedGlossaries = createContext<GlossariesValue | null>(null);

function useOwnGlossaries(enabled: boolean): GlossariesValue {
  const [glossaries, setGlossaries] = useState<Glossary[]>([]);
  const [status, setStatus] = useState<GlossariesState>('loading');

  const reload = useCallback(async () => {
    try {
      const result = await listGlossaries();
      setGlossaries(result.glossaries);
      setStatus('ready');
    } catch {
      setGlossaries([]);
      setStatus('failed');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listGlossaries()
      .then((result) => {
        if (cancelled) return;
        setGlossaries(result.glossaries);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setGlossaries([]);
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const save = useCallback(
    async (glossaryId: string, body: SaveGlossaryRequest) => {
      await saveGlossary(glossaryId, body);
      await reload();
    },
    [reload],
  );

  const patch = useCallback(
    async (glossaryId: string, body: PatchGlossaryRequest) => {
      await patchGlossary(glossaryId, body);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (glossaryId: string) => {
      await deleteGlossary(glossaryId);
      await reload();
    },
    [reload],
  );

  return { glossaries, status, save, patch, remove };
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

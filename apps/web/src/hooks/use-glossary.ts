'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  CreateGlossaryTermRequest,
  GlossaryTermRecord,
  ImportGlossaryRequest,
  UpdateGlossaryTermRequest,
} from '@chatofy/types';
import { ApiClientError } from '@chatofy/api-client';
import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  importGlossary,
  listGlossary,
  updateGlossaryTerm,
} from '@/clients/api-client';

/** Why a write did not take, in the vocabulary the card can act on. */
export type WriteResult = 'ok' | 'duplicate' | 'error';

export interface UseGlossary {
  terms: GlossaryTermRecord[];
  /** The first load is in flight. */
  loading: boolean;
  /** The load failed; the list is empty and a retry is offered. */
  loadError: boolean;
  add: (body: CreateGlossaryTermRequest) => Promise<WriteResult>;
  update: (id: string, patch: UpdateGlossaryTermRequest) => Promise<WriteResult>;
  remove: (id: string) => Promise<boolean>;
  /** Bulk-import already-parsed terms; the resulting glossary replaces local state. */
  importTerms: (
    terms: ImportGlossaryRequest['terms'],
    mode: ImportGlossaryRequest['mode'],
  ) => Promise<boolean>;
  reload: () => Promise<void>;
}

/** A 409 is the one failure the caller distinguishes — a duplicate (vi, en) pair. */
function classify(err: unknown): 'duplicate' | 'error' {
  return err instanceof ApiClientError && err.status === 409 ? 'duplicate' : 'error';
}

/**
 * Request state for the caller's whole glossary.
 *
 * The list is the source of truth in local state and is patched from each
 * mutation's returned record rather than re-fetched, so an add or an edit
 * shows immediately without a second round trip. Ownership is entirely
 * server-side — nothing here names a user.
 */
export function useGlossary(): UseGlossary {
  const [terms, setTerms] = useState<GlossaryTermRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const { terms: rows } = await listGlossary();
      setTerms(rows);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // The first load runs inline rather than through `reload` so no state is set
  // synchronously in the effect body (the list already starts `loading`): every
  // `setState` here happens after an `await`. The guard drops a response that
  // arrives after unmount.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { terms: rows } = await listGlossary();
        if (active) setTerms(rows);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const add = useCallback(async (body: CreateGlossaryTermRequest): Promise<WriteResult> => {
    try {
      const { term } = await createGlossaryTerm(body);
      setTerms((prev) => [...prev, term]);
      return 'ok';
    } catch (err) {
      return classify(err);
    }
  }, []);

  const update = useCallback(
    async (id: string, patch: UpdateGlossaryTermRequest): Promise<WriteResult> => {
      try {
        const { term } = await updateGlossaryTerm(id, patch);
        setTerms((prev) => prev.map((t) => (t.id === id ? term : t)));
        return 'ok';
      } catch (err) {
        return classify(err);
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteGlossaryTerm(id);
      setTerms((prev) => prev.filter((t) => t.id !== id));
      return true;
    } catch {
      return false;
    }
  }, []);

  const importTerms = useCallback(
    async (
      terms: ImportGlossaryRequest['terms'],
      mode: ImportGlossaryRequest['mode'],
    ): Promise<boolean> => {
      try {
        const { terms: rows } = await importGlossary({ terms, mode });
        setTerms(rows);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  return { terms, loading, loadError, add, update, remove, importTerms, reload };
}

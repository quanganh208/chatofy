'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LanguageCode, MeetingMinutes } from '@chatofy/types';
import { ApiClientError } from '@chatofy/api-client';
import { generateMinutes, getMinutes } from '@/clients/api-client';

export interface UseMinutes {
  /** A generation pass is in flight. */
  loading: boolean;
  /** The last generated minutes, or null before the first pass. */
  minutes: MeetingMinutes | null;
  /** The last pass failed. Cleared when a new pass starts. */
  error: boolean;
  /** Run (or re-run) a summarization pass over a stored conversation. */
  generate: (conversationId: string, language?: LanguageCode) => Promise<void>;
  /** Forget the current result (e.g. when the conversation is reset). */
  reset: () => void;
}

/**
 * Request state machine for one conversation's minutes.
 *
 * `error` is a boolean, not a message: every failure the panel can act on reads
 * the same — "try again" — and the server forces a generic message on its 5xx
 * anyway, so mapping the thrown error to prose would only invent detail the user
 * cannot use. A concurrent second `generate` is not guarded here because the
 * button that drives it is disabled while `loading`.
 *
 * `loadFor` is OPT-IN and defaults to absent, so the translate panel is unchanged:
 * it must not fetch minutes on mount, because on that screen the conversation has
 * not happened yet. The history detail screen passes a conversation id, where
 * reading an existing summary back is the whole point. A 404 there means "none
 * generated yet" — an ordinary state, not a failure — so it leaves `error` false.
 */
export function useMinutes(loadFor?: string): UseMinutes {
  const [loading, setLoading] = useState(false);
  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [error, setError] = useState(false);

  const generate = useCallback(
    async (conversationId: string, language?: LanguageCode): Promise<void> => {
      setLoading(true);
      setError(false);
      try {
        const { minutes: result } = await generateMinutes(conversationId, language);
        setMinutes(result);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // The opt-in initial read. Cancelled on unmount and on an id change so a slow
  // response cannot write the previous conversation's minutes onto a new screen.
  useEffect(() => {
    if (!loadFor) return;
    let cancelled = false;
    setLoading(true);
    getMinutes(loadFor)
      .then(({ minutes: existing }) => {
        if (!cancelled) setMinutes(existing);
      })
      .catch((err: unknown) => {
        // 404 is "no minutes yet", which the panel already renders as its empty
        // state. Treating it as an error would put "could not generate minutes"
        // under every conversation nobody has summarized.
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) return;
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadFor]);

  const reset = useCallback((): void => {
    setMinutes(null);
    setError(false);
  }, []);

  return { loading, minutes, error, generate, reset };
}

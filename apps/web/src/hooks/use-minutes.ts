'use client';

import { useCallback, useState } from 'react';
import type { LanguageCode, MeetingMinutes, MinutesSourceTurn } from '@chatofy/types';
import { generateMinutes } from '@/clients/api-client';

export interface UseMinutes {
  /** A generation pass is in flight. */
  loading: boolean;
  /** The last generated minutes, or null before the first pass. */
  minutes: MeetingMinutes | null;
  /** The last pass failed. Cleared when a new pass starts. */
  error: boolean;
  /** Run (or re-run) a summarization pass over the given turns. */
  generate: (
    sessionId: string,
    turns: MinutesSourceTurn[],
    language?: LanguageCode,
  ) => Promise<void>;
  /** Forget the current result (e.g. when the conversation is reset). */
  reset: () => void;
}

/**
 * Request state machine for one session's minutes.
 *
 * `error` is a boolean, not a message: every failure the panel can act on reads
 * the same — "try again" — and the server forces a generic message on its 5xx
 * anyway, so mapping the thrown error to prose would only invent detail the user
 * cannot use. A concurrent second `generate` is not guarded here because the
 * button that drives it is disabled while `loading`.
 */
export function useMinutes(): UseMinutes {
  const [loading, setLoading] = useState(false);
  const [minutes, setMinutes] = useState<MeetingMinutes | null>(null);
  const [error, setError] = useState(false);

  const generate = useCallback(
    async (
      sessionId: string,
      turns: MinutesSourceTurn[],
      language?: LanguageCode,
    ): Promise<void> => {
      setLoading(true);
      setError(false);
      try {
        const { minutes: result } = await generateMinutes(sessionId, turns, language);
        setMinutes(result);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback((): void => {
    setMinutes(null);
    setError(false);
  }, []);

  return { loading, minutes, error, generate, reset };
}

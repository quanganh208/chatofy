'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConferenceDetailResponse, ConferenceMinutes, LanguageCode } from '@chatofy/types';
import { ApiClientError } from '@chatofy/api-client';
import {
  generateConferenceMinutes,
  getConference,
  getConferenceMinutes,
} from '@/clients/api-client';

/** Where the first read of the end screen stands. */
type ConferenceEndLoad = 'loading' | 'ready' | 'not-found' | 'failed';

export interface UseConferenceEnd {
  load: ConferenceEndLoad;
  /** The room with its participants; null until `load` is `ready`. */
  conference: ConferenceDetailResponse | null;
  /** The room's stored minutes, or null when nobody has generated them. */
  minutes: ConferenceMinutes | null;
  /** A generation pass is in flight. */
  generating: boolean;
  /** The last generation request failed. Cleared when a new one starts. */
  generateFailed: boolean;
  /** Run (or re-run) a pass, written in `language`. */
  generate: (language?: LanguageCode) => Promise<void>;
}

/**
 * Request state for the meeting end screen: the room and its minutes, read
 * together, and a generate that replaces the room's one stored copy.
 *
 * A 404 from either read means the caller was not in this room (or it does not
 * exist — the API answers both alike), which the screen says plainly rather than
 * as an error to retry. "No minutes yet" is not a 404 here: the minutes read
 * answers `null`, so it is the ordinary empty state.
 *
 * The room id is fixed for the life of the screen, so the only stale write to
 * guard is one landing after unmount.
 */
export function useConferenceEnd(conferenceId: string): UseConferenceEnd {
  const [load, setLoad] = useState<ConferenceEndLoad>('loading');
  const [conference, setConference] = useState<ConferenceDetailResponse | null>(null);
  const [minutes, setMinutes] = useState<ConferenceMinutes | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    Promise.all([getConference(conferenceId), getConferenceMinutes(conferenceId)])
      .then(([detail, stored]) => {
        if (!mounted.current) return;
        setConference(detail);
        setMinutes(stored.minutes);
        setLoad('ready');
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setLoad(err instanceof ApiClientError && err.status === 404 ? 'not-found' : 'failed');
      });
    return () => {
      mounted.current = false;
    };
  }, [conferenceId]);

  const generate = useCallback(
    async (language?: LanguageCode): Promise<void> => {
      setGenerating(true);
      setGenerateFailed(false);
      try {
        const { minutes: result } = await generateConferenceMinutes(conferenceId, language);
        if (mounted.current) setMinutes(result);
      } catch {
        if (mounted.current) setGenerateFailed(true);
      } finally {
        if (mounted.current) setGenerating(false);
      }
    },
    [conferenceId],
  );

  return { load, conference, minutes, generating, generateFailed, generate };
}

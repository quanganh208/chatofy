/**
 * Request state for the meeting end screen — the mobile twin of the web's
 * `use-conference-end`: the room and its minutes, read together, and a generate
 * that replaces the room's one stored copy.
 *
 * A 404 from either read means the caller was not in this room (or it does not
 * exist; the API answers both alike). "No minutes yet" is not a 404: the minutes
 * read answers `null`, the ordinary empty state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@chatofy/api-client';
import type { ConferenceDetailResponse, ConferenceMinutes, LanguageCode } from '@chatofy/types';
import {
  generateConferenceMinutes,
  getConference,
  getConferenceMinutes,
} from '@/clients/api-client';

type ConferenceEndLoad = 'loading' | 'ready' | 'not-found' | 'failed';

export interface UseConferenceEnd {
  load: ConferenceEndLoad;
  conference: ConferenceDetailResponse | null;
  minutes: ConferenceMinutes | null;
  generating: boolean;
  /** The last generation request failed; cleared when a new one starts. */
  generateFailed: boolean;
  generate: (language: LanguageCode) => Promise<void>;
}

export function useConferenceEnd(conferenceId: string): UseConferenceEnd {
  const [load, setLoad] = useState<ConferenceEndLoad>('loading');
  const [conference, setConference] = useState<ConferenceDetailResponse | null>(null);
  const [minutes, setMinutes] = useState<ConferenceMinutes | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    Promise.all([getConference(conferenceId), getConferenceMinutes(conferenceId)])
      .then(([detail, stored]) => {
        if (!mountedRef.current) return;
        setConference(detail);
        setMinutes(stored.minutes);
        setLoad('ready');
      })
      .catch((err: unknown) => {
        if (!mountedRef.current) return;
        setLoad(err instanceof ApiClientError && err.status === 404 ? 'not-found' : 'failed');
      });
    return () => {
      mountedRef.current = false;
    };
  }, [conferenceId]);

  const generate = useCallback(
    async (language: LanguageCode) => {
      setGenerating(true);
      setGenerateFailed(false);
      try {
        const { minutes: result } = await generateConferenceMinutes(conferenceId, language);
        if (mountedRef.current) setMinutes(result);
      } catch {
        if (mountedRef.current) setGenerateFailed(true);
      } finally {
        if (mountedRef.current) setGenerating(false);
      }
    },
    [conferenceId],
  );

  return { load, conference, minutes, generating, generateFailed, generate };
}

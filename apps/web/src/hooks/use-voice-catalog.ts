'use client';

import { useEffect, useState } from 'react';
import { listVoices, type TtsVoice } from '@/clients/api-client';
import { directionLanguages, type TranslationDirection } from '@chatofy/types';

/**
 * What the catalog request produced.
 *
 * `empty` and `failed` are separate states on purpose, and collapsing them is the
 * specific mistake this type exists to prevent: a backend that genuinely offers
 * one voice and a backend that could not be reached both yield "no voices to show",
 * and if the UI treats them identically then an expired session or a stopped
 * sidecar looks exactly like a feature working correctly — permanently, with every
 * test still green.
 */
export type VoiceCatalogState =
  | { status: 'loading'; voices: TtsVoice[] }
  | { status: 'ready'; voices: TtsVoice[] }
  | { status: 'failed'; voices: TtsVoice[] };

/**
 * The voices the running backend offers for whichever language is being SPOKEN.
 *
 * Keyed by output language rather than by direction, because that is what decides
 * which engine answers — and the two engines share no vocabulary, so a token from
 * one is meaningless to the other.
 */
export function useVoiceCatalog(direction: TranslationDirection): VoiceCatalogState {
  const outputLanguage = directionLanguages(direction).target;
  const [state, setState] = useState<VoiceCatalogState>({ status: 'loading', voices: [] });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', voices: [] });

    listVoices(outputLanguage)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', voices: result.voices });
      })
      .catch(() => {
        // Deliberately not rethrown and deliberately not silent: the caller shows
        // this state rather than pretending the backend has no voices.
        if (!cancelled) setState({ status: 'failed', voices: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [outputLanguage]);

  return state;
}

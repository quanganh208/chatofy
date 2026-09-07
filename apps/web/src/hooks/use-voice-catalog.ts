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

type OutputLanguage = ReturnType<typeof directionLanguages>['target'];

/**
 * Lists already fetched in this tab, keyed by the language they list.
 *
 * The panel that reads this hook lives inside a popover, and Radix unmounts popover
 * content on close. Without a cache the hook is therefore a request PER OPEN: the
 * list is identical every time, it is a property of the deployed backend rather
 * than of the user, and a reader who opens the voice group four times to compare
 * options spends four calls on the same answer — which is what makes an endpoint
 * with a rate limit in front of it fire on ordinary use.
 *
 * Module scope rather than a provider, because the cache key is the language and
 * the value is the same for every component in the tab; a context would add a tree
 * to hold one map.
 */
const cachedVoices = new Map<OutputLanguage, TtsVoice[]>();

/**
 * Requests still in the air, so two panels mounting in the same tick share one GET
 * instead of racing.
 */
const pendingVoices = new Map<OutputLanguage, Promise<TtsVoice[]>>();

function loadVoices(language: OutputLanguage): Promise<TtsVoice[]> {
  const pending = pendingVoices.get(language);
  if (pending) return pending;

  const request = listVoices(language)
    .then((result) => {
      cachedVoices.set(language, result.voices);
      return result.voices;
    })
    .finally(() => {
      // Only the SUCCESS is remembered. Dropping the in-flight entry on failure
      // means the next open retries — a stopped sidecar or an expired session must
      // not pin "failed" for the life of the tab.
      pendingVoices.delete(language);
    });

  pendingVoices.set(language, request);
  return request;
}

function cachedState(language: OutputLanguage): VoiceCatalogState {
  const voices = cachedVoices.get(language);
  // Straight to `ready` on a reopen, so a cached list does not flash "loading" for
  // a frame before showing the same options it showed a moment ago.
  return voices ? { status: 'ready', voices } : { status: 'loading', voices: [] };
}

/**
 * The voices the running backend offers for whichever language is being SPOKEN.
 *
 * Keyed by output language rather than by direction, because that is what decides
 * which engine answers — and the two engines share no vocabulary, so a token from
 * one is meaningless to the other.
 */
export function useVoiceCatalog(direction: TranslationDirection): VoiceCatalogState {
  const outputLanguage = directionLanguages(direction).target;
  const [state, setState] = useState<VoiceCatalogState>(() => cachedState(outputLanguage));
  const [shownFor, setShownFor] = useState(outputLanguage);

  // Reset during render rather than in an effect: switching direction must not
  // paint the other engine's voices for a frame, and a cached list must not blink
  // through "loading" on the way back.
  if (shownFor !== outputLanguage) {
    setShownFor(outputLanguage);
    setState(cachedState(outputLanguage));
  }

  useEffect(() => {
    if (cachedVoices.has(outputLanguage)) return;

    let cancelled = false;

    loadVoices(outputLanguage)
      .then((voices) => {
        if (!cancelled) setState({ status: 'ready', voices });
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

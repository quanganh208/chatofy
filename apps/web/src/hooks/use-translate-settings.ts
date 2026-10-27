'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_TRANSLATE_SETTINGS,
  loadTranslateSettings,
  saveTranslateSettings,
  type TranslateSettings,
} from '@/lib/translate-settings';

/**
 * How long a burst of changes settles before it is written.
 *
 * A slider reports every pointer move, and this page schedules translated audio on
 * the same main thread. Writing on each tick means a `JSON.stringify` plus a
 * synchronous `localStorage.setItem` per frame, competing with playback for the
 * thread that must not stall. Long enough to collapse a drag into one write.
 *
 * Nothing is lost to the delay: the flush effect below writes any pending change on
 * unmount and on the page going away.
 */
const PERSIST_DEBOUNCE_MS = 200;

/** Nothing outside this hook changes the answer to "has this client hydrated". */
const subscribeNever = () => () => {};

export interface UseTranslateSettings {
  settings: TranslateSettings;
  /**
   * False until the stored settings have been read.
   *
   * The server has no storage, so the server render and the hydrating render show
   * defaults; `useSyncExternalStore` flips this the render after hydration, and a
   * mount that is not hydrating (client-side navigation) is ready on its first
   * render. A control rendered against those defaults and then corrected a frame
   * later reads as the UI changing its own mind, so callers wait on this instead.
   */
  ready: boolean;
  /** Merge a patch into the settings. State updates now; storage settles. */
  set: (patch: Partial<TranslateSettings>) => void;
  /**
   * The current settings, readable from a closure that outlives a render.
   *
   * This exists for one specific consumer: `useStreamingTranslate` builds its
   * `ConversationSession` ONCE, on first render, which is before this hook has
   * read storage. Anything that closure captures by value is frozen at the
   * defaults for the lifetime of the page — the same trap the access token has,
   * and solved the same way, by handing over a reader instead of a value.
   */
  current: () => TranslateSettings;
}

export function useTranslateSettings(): UseTranslateSettings {
  // Read once, in the initializer. The server answers defaults without touching
  // storage: Node 26 defines a global `localStorage` that prints an
  // ExperimentalWarning when read without a backing file. On a hydrating client it
  // is the real stored value, held back from the output by `ready` below so the
  // hydrating render still matches what the server sent.
  const [settings, setSettings] = useState<TranslateSettings>(() =>
    typeof window === 'undefined' ? DEFAULT_TRANSLATE_SETTINGS : loadTranslateSettings(),
  );
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  // Mirrors state so a closure built before the first commit still sees the
  // latest value. Written synchronously in `set` rather than in an effect,
  // because a consumer may read it in the same tick a change is made.
  const settingsRef = useRef(settings);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = useCallback((patch: Partial<TranslateSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // The REF, not the `next` this closure captured, so the timer and `flush`
      // write from the same place: whatever the ref holds is the merge of every
      // patch so far, over what was stored.
      saveTranslateSettings(settingsRef.current);
    }, PERSIST_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    saveTranslateSettings(settingsRef.current);
  }, []);

  /**
   * A pending write must survive the page going away, not just the component.
   *
   * React cleanup covers unmount and client-side navigation. It does NOT run on a
   * tab close, a reload, or bfcache eviction — so without this, dragging the volume
   * slider and immediately closing the tab loses the change. `pagehide` is the event
   * that fires in all three cases; `visibilitychange` catches the mobile case where
   * the tab is backgrounded and later killed without ever firing `pagehide`.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [flush]);

  const current = useCallback(() => settingsRef.current, []);

  return { settings: ready ? settings : DEFAULT_TRANSLATE_SETTINGS, ready, set, current };
}

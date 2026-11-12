'use client';

import { useSyncExternalStore } from 'react';

/**
 * Which translator the mobile Translate tab opens: the mode the reader used last.
 *
 * One-way and two-way are separate routes and the tab bar has room for one Translate
 * tab, so the tab follows the reader rather than making them choose every time —
 * switching between the two lives on the translator itself.
 *
 * Every storage touch is wrapped: Safari private mode and a disabled-storage policy
 * throw on access, and a navigation aid must never take a screen down with it. The
 * server and the first client render both answer one-way, so hydration agrees; the
 * stored choice arrives on the render after.
 */
const TRANSLATE_MODES = ['/translate/one-way', '/translate/two-way'] as const;
export type TranslateMode = (typeof TRANSLATE_MODES)[number];

const KEY = 'chatofy.translate-mode';
const DEFAULT_MODE: TranslateMode = '/translate/one-way';
/** `storage` fires only in OTHER tabs, so this tab announces its own writes. */
const LOCAL_EVENT = 'chatofy:translate-mode';

const asMode = (value: string | null): TranslateMode | undefined =>
  TRANSLATE_MODES.find((mode) => mode === value);

function read(): TranslateMode {
  try {
    return asMode(window.localStorage.getItem(KEY)) ?? DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

/** Records `pathname` when it is one of the two translators; anything else is ignored. */
export function rememberTranslateMode(pathname: string): void {
  const mode = asMode(pathname);
  if (!mode) return;
  try {
    if (window.localStorage.getItem(KEY) === mode) return;
    window.localStorage.setItem(KEY, mode);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(LOCAL_EVENT));
}

export function useLastTranslateMode(): TranslateMode {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_MODE);
}

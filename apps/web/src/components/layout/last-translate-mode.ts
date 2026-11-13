'use client';

import { useCallback } from 'react';
import type { TranslateModePreference } from '@chatofy/types';
import { usePreferences } from '@/hooks/use-preferences';

/**
 * Which translator the mobile Translate tab opens: the mode the reader used last.
 *
 * One-way and two-way are separate routes and the tab bar has room for one Translate
 * tab, so the tab follows the reader rather than making them choose every time —
 * switching between the two lives on the translator itself.
 *
 * An account preference (`translateMode`), so the phone's tab opens where the laptop
 * left off. The server and the first client render both answer one-way, so
 * hydration agrees; the stored choice arrives on the render after.
 */
const ROUTES = {
  'one-way': '/translate/one-way',
  'two-way': '/translate/two-way',
} as const satisfies Record<TranslateModePreference, string>;

export type TranslateMode = (typeof ROUTES)[TranslateModePreference];

const modeOf = (pathname: string): TranslateModePreference | undefined =>
  (Object.keys(ROUTES) as TranslateModePreference[]).find((mode) => ROUTES[mode] === pathname);

export function useLastTranslateMode(): TranslateMode {
  const { preferences, ready } = usePreferences();
  return ROUTES[ready ? preferences.translateMode : 'one-way'];
}

/**
 * Records `pathname` when it is one of the two translators; anything else is
 * ignored, and so is a visit to the mode already recorded — a save per navigation
 * would be a request per click.
 */
export function useRememberTranslateMode(): (pathname: string) => void {
  const { preferences, ready, update } = usePreferences();
  const recorded = preferences.translateMode;
  return useCallback(
    (pathname: string) => {
      const mode = modeOf(pathname);
      if (!ready || !mode || mode === recorded) return;
      update({ translateMode: mode });
    },
    [ready, recorded, update],
  );
}

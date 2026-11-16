/**
 * The theme this phone last applied, kept outside the account document so the
 * first frame after a cold start is already in it.
 *
 * The account's `theme` arrives asynchronously (the SecureStore cache, then the
 * server), and until it does the preferences read as defaults — `system`. Without
 * this, an account set to Dark on a light phone painted light first and flipped.
 * Read synchronously, so it can be applied before the first render. A theme is
 * not personal data, so it stays on the device after sign-out, set to `system`.
 */

import * as SecureStore from 'expo-secure-store';
import { parseThemeChoice } from './remembered-theme-value';
import type { ThemeChoice } from '@chatofy/types';

const KEY = 'chatofy.theme';

export function readRememberedTheme(): ThemeChoice {
  try {
    return parseThemeChoice(SecureStore.getItem(KEY));
  } catch {
    return 'system';
  }
}

export function rememberTheme(choice: ThemeChoice): void {
  try {
    SecureStore.setItem(KEY, choice);
  } catch {
    // Only the next cold start's first frame depends on it.
  }
}

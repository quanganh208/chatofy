/**
 * The app's theme, handed to Android: the choice is stored for this app (API 31
 * and up), so the native splash and the system bars of the next cold start are
 * drawn in it, and the open window's bars follow the scheme drawn now.
 *
 * A no-op where the native module is missing (Expo Go, tests, iOS) and on older
 * Android, where the splash keeps following the phone.
 */

import { requireOptionalNativeModule } from 'expo';

type Choice = 'light' | 'dark' | 'system';

interface NativeModule {
  set(choice: Choice): boolean;
  setSystemBarsDark(dark: boolean): void;
}

const native = requireOptionalNativeModule<NativeModule>('AppNightMode');

/** Store the choice with Android; returns whether it was stored. */
export function setAppNightMode(choice: Choice): boolean {
  return native?.set(choice) ?? false;
}

/**
 * Style the open window's status and navigation bars for the scheme the app
 * draws now: they were styled when the window was created, before any change.
 */
export function setSystemBarsDark(dark: boolean): void {
  native?.setSystemBarsDark(dark);
}

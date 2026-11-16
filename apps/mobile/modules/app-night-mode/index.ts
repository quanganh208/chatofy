/**
 * The app's theme, handed to Android: the choice is stored for this app (API 31
 * and up), so the native splash and the system bars of the next cold start are
 * drawn in it, and the open window's navigation bar follows the scheme drawn now.
 *
 * A no-op where the native module is missing (Expo Go, tests, iOS) and on older
 * Android, where the splash keeps following the phone.
 */

import { requireOptionalNativeModule } from 'expo';

type Choice = 'light' | 'dark' | 'system';

interface NativeModule {
  set(choice: Choice): boolean;
  setNavigationBarDark(dark: boolean): void;
}

const native = requireOptionalNativeModule<NativeModule>('AppNightMode');

/** Store the choice with Android; returns whether it was stored. */
export function setAppNightMode(choice: Choice): boolean {
  return native?.set(choice) ?? false;
}

/**
 * Style the open window's navigation bar for the scheme the app draws now: the
 * bars were styled when the window was created, before any later change.
 */
export function setNavigationBarDark(dark: boolean): void {
  native?.setNavigationBarDark(dark);
}

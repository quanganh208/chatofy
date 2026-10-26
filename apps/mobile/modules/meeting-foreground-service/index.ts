/**
 * Keeps a meeting's microphone alive while the app is in the background.
 *
 * Android only: it starts a foreground service of type `microphone` with an
 * ongoing notification. iOS needs no code for this — `UIBackgroundModes: audio`
 * in `app.json` keeps an active audio session running — so both calls are no-ops
 * there, as they are when the native module is missing (Expo Go, tests).
 */

import { requireOptionalNativeModule } from 'expo';

interface NativeModule {
  start(title: string, text: string): boolean;
  stop(): void;
}

const native = requireOptionalNativeModule<NativeModule>('MeetingForegroundService');

/** Show the ongoing-meeting notification and keep the microphone in the background. */
export function startMeetingForegroundService(title: string, text: string): boolean {
  return native?.start(title, text) ?? false;
}

/** End it; safe to call when it is not running. */
export function stopMeetingForegroundService(): void {
  native?.stop();
}

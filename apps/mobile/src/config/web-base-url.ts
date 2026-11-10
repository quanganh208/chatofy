/**
 * The web app's origin, for the few things the phone hands over to it: buying
 * credits happens on the web's account page, never in the app, so no store
 * in-app-purchase flow applies.
 *
 * `EXPO_PUBLIC_WEB_BASE_URL` is inlined by Expo at bundle time, like the API
 * origin beside it; the fallback is the Android emulator's alias for the host
 * machine's web dev server.
 */
export const WEB_BASE_URL = (
  process.env['EXPO_PUBLIC_WEB_BASE_URL'] ?? 'http://10.0.2.2:3001'
).replace(/\/+$/, '');

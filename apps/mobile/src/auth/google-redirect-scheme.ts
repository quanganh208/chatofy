/**
 * Kept free of imports: `app.config.ts` loads it while Expo reads the config,
 * before any of the app's own modules or aliases exist.
 */

/**
 * The URL scheme Google redirects an iOS client back to: the client id reversed,
 * `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`.
 * It must be registered in the app config for the sign-in to return to the app.
 */
export function googleIosRedirectScheme(iosClientId: string | undefined): string | null {
  const suffix = '.apps.googleusercontent.com';
  const id = iosClientId?.trim();
  if (!id || !id.endsWith(suffix) || id.length === suffix.length) return null;
  return `com.googleusercontent.apps.${id.slice(0, -suffix.length)}`;
}

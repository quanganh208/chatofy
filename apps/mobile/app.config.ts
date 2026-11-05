import type { ConfigContext, ExpoConfig } from 'expo/config';
import { googleIosRedirectScheme } from './src/auth/google-redirect-scheme.ts';

/**
 * `app.json` stays the base; this adds what depends on the build's environment.
 *
 * Expo's Google provider redirects to `<application id>:/oauthredirect`, so the
 * package name must be a URL scheme the app owns. The reversed iOS client id
 * (`com.googleusercontent.apps.<id>`) is registered beside it as the other form
 * Google accepts for an iOS client; it is derived so it is not copied by hand.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const own = typeof config.scheme === 'string' ? [config.scheme] : (config.scheme ?? []);
  const googleIos = googleIosRedirectScheme(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS);
  const androidPackage = config.android?.package;
  const schemes = [
    ...own,
    ...(googleIos ? [googleIos] : []),
    ...(androidPackage ? [androidPackage] : []),
  ];

  return {
    ...config,
    name: config.name ?? 'mobile',
    slug: config.slug ?? 'mobile',
    scheme: schemes,
  };
};

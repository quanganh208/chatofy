import type { ConfigContext, ExpoConfig } from 'expo/config';
import { googleIosRedirectScheme } from './src/auth/google-redirect-scheme.ts';

/**
 * `app.json` stays the base; this adds what depends on the build's environment.
 *
 * Google returns an iOS sign-in to the reversed client id (`com.googleusercontent
 * .apps.<id>`) and an Android one to the package name, and both must be URL
 * schemes the app owns. The iOS one is derived from the client id so it is not
 * copied by hand; without a client id the scheme list is just the app's own.
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

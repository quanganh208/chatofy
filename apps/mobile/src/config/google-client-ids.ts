/**
 * The Google OAuth client ids this build was made with. Expo inlines
 * `EXPO_PUBLIC_*` at build time, so a change needs a new dev build. Unset means
 * the "Continue with Google" button is not offered on that platform.
 */

import type { GoogleClientIds } from '@/auth/google-sign-in';

export const GOOGLE_CLIENT_IDS: GoogleClientIds = {
  ios: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS,
  android: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID,
};

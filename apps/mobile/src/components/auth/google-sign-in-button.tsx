/**
 * "Continue with Google": opens Google's sheet through Expo's auth session, takes
 * the id_token it returns and trades it for a session at `POST /auth/google`.
 *
 * Rendered only where a client id is configured for the platform. The hook that
 * builds the request lives in an inner component because it refuses to be called
 * without an id, and hooks cannot be called conditionally.
 */

import { useState } from 'react';
import { Platform } from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { clientIdFor, googleFailureMessage, readGoogleResponse } from '@/auth/google-sign-in';
import { GOOGLE_CLIENT_IDS } from '@/config/google-client-ids';
import { useAuth } from '@/providers/auth-provider';
import { GhostButton } from '@/ui/components/ghost-button';

// Lets the browser sheet hand control back to the app on platforms that need it.
WebBrowser.maybeCompleteAuthSession();

const t = createTranslator(en);

interface GoogleSignInButtonProps {
  onSignedIn: () => void;
  onError: (message: MessageKey | null) => void;
}

export function GoogleSignInButton(props: GoogleSignInButtonProps) {
  if (!clientIdFor(Platform.OS, GOOGLE_CLIENT_IDS)) return null;
  return <ConfiguredGoogleButton {...props} />;
}

function ConfiguredGoogleButton({ onSignedIn, onError }: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [request, , promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_CLIENT_IDS.ios,
    androidClientId: GOOGLE_CLIENT_IDS.android,
  });

  // `promptAsync` resolves with the result, so the exchange runs from the press
  // itself and a re-render can never send the one-use token twice.
  async function start() {
    if (busy) return;
    onError(null);
    setBusy(true);
    try {
      const outcome = readGoogleResponse(await promptAsync());
      if (outcome.kind === 'idToken') {
        await signInWithGoogle(outcome.idToken);
        onSignedIn();
        return;
      }
      if (outcome.kind === 'failed') onError('web.auth.signInUnavailable');
    } catch (err) {
      onError(googleFailureMessage(err));
    }
    setBusy(false);
  }

  return (
    <GhostButton
      label={t('web.auth.continueWithGoogle')}
      onPress={() => void start()}
      disabled={!request || busy}
    />
  );
}

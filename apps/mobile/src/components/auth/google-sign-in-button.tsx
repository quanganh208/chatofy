/**
 * "Continue with Google": opens Google's sheet through Expo's auth session, trades
 * the code it returns for an id_token, and that for a session at `POST /auth/google`.
 *
 * Rendered only where a client id is configured for the platform. The hook that
 * builds the request lives in an inner component because it refuses to be called
 * without an id, and hooks cannot be called conditionally.
 */

import { useState } from 'react';
import { Platform } from 'react-native';
import { exchangeCodeAsync } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { clientIdFor, finishGoogleSignIn } from '@/auth/google-sign-in';
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
  // The hook's own exchange is off: `promptAsync` resolves before it runs, and a
  // failure there rejects with nobody listening.
  const [request, , promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_CLIENT_IDS.ios,
    androidClientId: GOOGLE_CLIENT_IDS.android,
    shouldAutoExchangeCode: false,
  });

  async function start() {
    if (busy || !request) return;
    onError(null);
    setBusy(true);
    const response = await promptAsync().catch(() => ({ type: 'error' }) as const);
    const result = await finishGoogleSignIn(response, {
      // PKCE: the redirect and verifier must be the ones the prompt was opened with.
      exchangeCode: async (code) => {
        const tokens = await exchangeCodeAsync(
          {
            clientId: request.clientId,
            redirectUri: request.redirectUri,
            code,
            extraParams: { code_verifier: request.codeVerifier ?? '' },
          },
          Google.discovery,
        );
        return tokens.idToken;
      },
      signIn: signInWithGoogle,
    });
    if (result.kind === 'signedIn') {
      onSignedIn();
      return;
    }
    if (result.kind === 'failed') onError(result.message);
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

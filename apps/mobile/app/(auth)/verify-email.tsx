/**
 * Opened by `chatofy://verify-email?token=…`. Mailed links are web links now, so
 * this screen is reached only by a link opened by hand or from an older mail.
 * Confirms the address as soon as the screen opens, since following the link is the
 * user's intent; nothing here signs anyone in. The token is never logged or stored.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { readLinkToken } from '@/auth/deep-link-token';
import { useAuth } from '@/providers/auth-provider';
import { AuthError, AuthStatus } from '@/components/auth/auth-notice';
import { AuthForm, AuthScreen } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

const t = createTranslator(en);

type State = { phase: 'working' } | { phase: 'done' } | { phase: 'failed'; message: MessageKey };

export default function VerifyEmailScreen() {
  const router = useRouter();
  const { verifyEmail } = useAuth();
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>();
  const token = readLinkToken(rawToken);

  const [state, setState] = useState<State>(
    token ? { phase: 'working' } : { phase: 'failed', message: 'mobile.auth.linkMissingToken' },
  );
  // A token is spent by the first request; StrictMode's second effect run must not send it again.
  const sentRef = useRef(false);

  useEffect(() => {
    if (!token || sentRef.current) return;
    sentRef.current = true;
    verifyEmail(token).then(
      () => setState({ phase: 'done' }),
      (err: unknown) => setState({ phase: 'failed', message: authFlowFailure('verifyEmail', err) }),
    );
  }, [token, verifyEmail]);

  return (
    <AuthScreen title={t('web.auth.verifyEmailHeading')}>
      <AuthForm>
        {state.phase === 'working' ? (
          <View className="flex-row items-center gap-2" role="status" aria-busy>
            <ActivityIndicator className="text-muted-foreground" />
            <Text variant="muted">{t('web.auth.verifying')}</Text>
          </View>
        ) : null}
        {state.phase === 'done' ? <AuthStatus message={t('mobile.auth.verifyDone')} /> : null}
        {state.phase === 'failed' ? <AuthError message={t(state.message)} /> : null}
        {state.phase !== 'working' ? (
          <Button onPress={() => router.replace('/sign-in')}>
            <Text>{t('common.auth.signIn')}</Text>
          </Button>
        ) : null}
      </AuthForm>
    </AuthScreen>
  );
}

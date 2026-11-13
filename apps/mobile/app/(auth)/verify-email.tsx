/**
 * Opened by `chatofy://verify-email?token=…`. Mailed links are web links now, so
 * this screen is reached only by a link opened by hand or from an older mail.
 * Confirms the address as soon as the screen opens, since following the link is the
 * user's intent; nothing here signs anyone in. The token is never logged or stored.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { readLinkToken } from '@/auth/deep-link-token';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { InlineNotice } from '@/ui/components/inline-notice';
import { PrimaryButton } from '@/ui/components/primary-button';
import { Screen } from '@/ui/components/screen';

const t = createTranslator(en);

type State = { phase: 'working' } | { phase: 'done' } | { phase: 'failed'; message: MessageKey };

export default function VerifyEmailScreen() {
  const { colors } = useTheme();
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
    <Screen centered>
      <Text style={{ color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.semibold }}>
        {t('web.auth.verifyEmailHeading')}
      </Text>
      {state.phase === 'working' ? <ActivityIndicator color={colors.textSecondary} /> : null}
      {state.phase === 'done' ? <InlineNotice message={t('mobile.auth.verifyDone')} /> : null}
      {state.phase === 'failed' ? <InlineNotice tone="error" message={t(state.message)} /> : null}
      {state.phase !== 'working' ? (
        <PrimaryButton label={t('common.auth.signIn')} onPress={() => router.replace('/sign-in')} />
      ) : null}
    </Screen>
  );
}

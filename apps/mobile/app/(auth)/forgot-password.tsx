/**
 * Asks for a password-reset link. The API answers the same for an address with
 * no account, so the notice is neutral: it never says whether the address exists.
 * The mailed link opens this app on `reset-password`.
 */

import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { fontSize, fontWeight, space } from '@chatofy/ui';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';
import { PrimaryButton } from '@/ui/components/primary-button';
import { Screen } from '@/ui/components/screen';
import { TextField } from '@/ui/components/text-field';

const t = createTranslator(en);

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (submitting) return;
    if (!email.trim()) {
      setError('mobile.auth.fillAllFields');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(authFlowFailure('forgotPassword', err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen centered>
      <Text
        style={{
          color: colors.text,
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          marginBottom: space.sm,
        }}
      >
        {t('web.auth.forgotPasswordLink')}
      </Text>

      {sent ? (
        <>
          <InlineNotice message={t('web.auth.resetLinkSent')} />
          <PrimaryButton
            label={t('web.auth.backToSignIn')}
            onPress={() => router.replace('/sign-in')}
          />
        </>
      ) : (
        <>
          <Text style={{ color: colors.textSecondary, fontSize: fontSize.base }}>
            {t('web.auth.forgotPasswordBody')}
          </Text>
          <TextField
            label={t('common.auth.email')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          {error ? <InlineNotice tone="error" message={t(error)} /> : null}
          <PrimaryButton
            label={t('web.auth.sendResetLink')}
            onPress={() => void submit()}
            busy={submitting}
          />
          <GhostButton
            variant="link"
            label={t('web.auth.backToSignIn')}
            onPress={() => router.replace('/sign-in')}
          />
        </>
      )}
    </Screen>
  );
}

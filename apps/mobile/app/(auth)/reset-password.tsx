/**
 * Opened by the reset link in the mail (`chatofy://reset-password?token=…`). Sets
 * the new password with that token; the API signs nobody in afterwards, so the next
 * step is sign-in. The token is never logged or stored.
 */

import { useState } from 'react';
import { Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fontSize, fontWeight, space } from '@chatofy/ui';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { readLinkToken } from '@/auth/deep-link-token';
import { validateNewPassword } from '@/auth/register-form-state';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';
import { PrimaryButton } from '@/ui/components/primary-button';
import { Screen } from '@/ui/components/screen';
import { TextField } from '@/ui/components/text-field';

const t = createTranslator(en);

export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { resetPassword } = useAuth();
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>();
  const token = readLinkToken(rawToken);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (submitting || !token) return;
    const problem = validateNewPassword(password, confirmPassword);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(authFlowFailure('resetPassword', err));
    } finally {
      setSubmitting(false);
    }
  }

  const heading = (
    <Text
      style={{
        color: colors.text,
        fontSize: fontSize.xl,
        fontWeight: fontWeight.semibold,
        marginBottom: space.sm,
      }}
    >
      {t('web.auth.resetPasswordHeading')}
    </Text>
  );

  if (!token) {
    return (
      <Screen centered>
        {heading}
        <InlineNotice tone="error" message={t('mobile.auth.linkMissingToken')} />
        <PrimaryButton
          label={t('web.auth.sendResetLink')}
          onPress={() => router.replace('/forgot-password')}
        />
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen centered>
        {heading}
        <InlineNotice message={t('mobile.auth.resetDone')} />
        <PrimaryButton label={t('common.auth.signIn')} onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen centered>
      {heading}
      <Text style={{ color: colors.textSecondary, fontSize: fontSize.base }}>
        {t('web.auth.chooseNewPassword')}
      </Text>
      <TextField
        label={t('web.auth.newPassword')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <TextField
        label={t('mobile.auth.confirmPassword')}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {error ? <InlineNotice tone="error" message={t(error)} /> : null}
      <PrimaryButton
        label={t('web.auth.resetPasswordSubmit')}
        onPress={() => void submit()}
        busy={submitting}
      />
      {error === 'mobile.auth.linkExpired' ? (
        <GhostButton
          variant="link"
          label={t('web.auth.sendResetLink')}
          onPress={() => router.replace('/forgot-password')}
        />
      ) : null}
    </Screen>
  );
}

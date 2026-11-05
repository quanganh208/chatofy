/**
 * Registration. The API creates no account here: it mails a verification link and
 * the account exists once the link is followed (it opens this app on
 * `verify-email`). So a successful submit shows a "check your email" notice and a
 * way back to sign-in, and never a session.
 */

import { useState } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { fontSize, fontWeight, space } from '@chatofy/ui';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { validateRegistration } from '@/auth/register-form-state';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';
import { PrimaryButton } from '@/ui/components/primary-button';
import { Screen } from '@/ui/components/screen';
import { TextField } from '@/ui/components/text-field';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function SignUpScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (submitting) return;
    const problem = validateRegistration({ name, email, password, confirmPassword });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signUp(email.trim(), password, name.trim());
      setSent(true);
    } catch (err) {
      setError(authFlowFailure('signUp', err));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <Screen centered>
        <Text
          style={{ color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.semibold }}
        >
          {t('web.auth.createAccountHeading')}
        </Text>
        <InlineNotice message={t('web.auth.checkYourEmail')} />
        <PrimaryButton
          label={t('web.auth.backToSignIn')}
          onPress={() => router.replace('/sign-in')}
        />
      </Screen>
    );
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
        {t('web.auth.createAccountHeading')}
      </Text>

      <TextField
        label={t('web.auth.name')}
        value={name}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
      />
      <TextField
        label={t('common.auth.email')}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <TextField
        label={t('common.auth.password')}
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
        label={t('web.auth.createAccount')}
        onPress={() => void submit()}
        busy={submitting}
      />
      <GoogleSignInButton onSignedIn={() => router.replace('/translate')} onError={setError} />
      <GhostButton
        variant="link"
        label={t('web.auth.backToSignIn')}
        onPress={() => router.replace('/sign-in')}
      />
    </Screen>
  );
}

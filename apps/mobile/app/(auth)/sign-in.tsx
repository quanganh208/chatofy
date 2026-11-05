/**
 * Email/password sign-in against the API's `POST /auth/login`. On success the
 * session is stored in secure storage and the user goes where they were headed
 * (`?next=`), or to the translate tab. Sign-in is the one accent control here.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { space, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { safeNextPath } from '@/auth/route-guard';
import { AuthRequestError } from '@/clients/http-auth-client';
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

/** Where a refused sign-in is explained; only these statuses mean something to the user. */
function failureMessage(err: unknown): MessageKey {
  if (err instanceof AuthRequestError) {
    if (err.status === 401) return 'mobile.auth.invalidCredentials';
    if (err.status === 429) return 'mobile.auth.tooManyAttempts';
  }
  return 'mobile.auth.signInFailed';
}

export default function SignInScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { signIn } = useAuth();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function submit() {
    if (submitting) return;
    if (!email.trim() || !password) {
      setError('mobile.auth.missingFields');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      router.replace(safeNextPath(next, '/translate') as Href);
    } catch (err) {
      setError(failureMessage(err));
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
        {t('mobile.auth.signInTitle')}
      </Text>

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
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />

      {error ? <InlineNotice tone="error" message={t(error)} /> : null}

      <PrimaryButton
        label={t('common.auth.signIn')}
        onPress={() => void submit()}
        busy={submitting}
      />
      <GhostButton
        variant="link"
        label={t('web.auth.forgotPasswordShort')}
        onPress={() => router.push('/forgot-password')}
      />

      <GoogleSignInButton
        onSignedIn={() => router.replace(safeNextPath(next, '/translate') as Href)}
        onError={setError}
      />

      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: colors.textSecondary, fontSize: fontSize.sm }}>
          {t('mobile.auth.noAccountPrompt')}
        </Text>
        <GhostButton
          variant="link"
          label={t('web.auth.createAccount')}
          onPress={() => router.push('/sign-up')}
        />
      </View>
    </Screen>
  );
}

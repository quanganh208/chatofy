/**
 * Email/password sign-in against the API's `POST /auth/login`. On success the
 * session is stored in secure storage and the user goes where they were headed
 * (`?next=`), or to the translate tab. Sign-in is the one accent control here.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { safeNextPath } from '@/auth/route-guard';
import { AuthRequestError } from '@/clients/http-auth-client';
import { useAuth } from '@/providers/auth-provider';
import { AuthField } from '@/components/auth/auth-field';
import { AuthError } from '@/components/auth/auth-notice';
import { AuthFooter, AuthForm, AuthScreen, AuthSubmit } from '@/components/auth/auth-screen';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

/** Where a refused sign-in is explained; only these statuses mean something to the user. */
function failureMessage(err: unknown): MessageKey {
  if (err instanceof AuthRequestError) {
    if (err.status === 401) return 'mobile.auth.invalidCredentials';
    if (err.status === 429) return 'common.auth.tooManyAttempts';
  }
  return 'mobile.auth.signInFailed';
}

export default function SignInScreen() {
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
    <AuthScreen title={t('mobile.auth.signInTitle')} description={t('web.auth.accountRequired')}>
      <GoogleSignInButton
        onSignedIn={() => router.replace(safeNextPath(next, '/translate') as Href)}
        onError={setError}
      />

      <AuthForm>
        <AuthField
          label={t('common.auth.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <AuthField
          label={t('common.auth.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        {error ? <AuthError message={t(error)} /> : null}
        <AuthSubmit
          label={t('common.auth.signIn')}
          busyLabel={t('common.auth.signingIn')}
          busy={submitting}
          onPress={() => void submit()}
        />
      </AuthForm>

      <AuthFooter>
        <Button variant="link" onPress={() => router.push('/forgot-password')}>
          <Text>{t('web.auth.forgotPasswordShort')}</Text>
        </Button>
        <View className="flex-row flex-wrap items-center justify-center">
          <Text variant="muted">{t('mobile.auth.noAccountPrompt')}</Text>
          <Button variant="link" className="px-2" onPress={() => router.push('/sign-up')}>
            <Text>{t('web.auth.createAccount')}</Text>
          </Button>
        </View>
      </AuthFooter>
    </AuthScreen>
  );
}

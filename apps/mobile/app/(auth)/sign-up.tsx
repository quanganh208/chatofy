/**
 * Registration. The API creates no account here: it mails a verification link and
 * the account exists once the link is followed (a web link, opened in the
 * browser). So a successful submit shows a "check your email" notice and a
 * way back to sign-in, and never a session.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { validateRegistration } from '@/auth/register-form-state';
import { useAuth } from '@/providers/auth-provider';
import { AuthField } from '@/components/auth/auth-field';
import { AuthError, AuthStatus } from '@/components/auth/auth-notice';
import { AuthFooter, AuthForm, AuthScreen, AuthSubmit } from '@/components/auth/auth-screen';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function SignUpScreen() {
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
      <AuthScreen title={t('web.auth.createAccountHeading')}>
        <AuthForm>
          <AuthStatus message={t('web.auth.checkYourEmail')} />
          <Button onPress={() => router.replace('/sign-in')}>
            <Text>{t('web.auth.backToSignIn')}</Text>
          </Button>
        </AuthForm>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('web.auth.createAccountHeading')}>
      <GoogleSignInButton onSignedIn={() => router.replace('/translate')} onError={setError} />

      <AuthForm>
        <AuthField
          label={t('web.auth.name')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
        />
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
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <AuthField
          label={t('mobile.auth.confirmPassword')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
        {error ? <AuthError message={t(error)} /> : null}
        <AuthSubmit
          label={t('web.auth.createAccount')}
          busyLabel={t('web.auth.creatingAccount')}
          busy={submitting}
          onPress={() => void submit()}
        />
      </AuthForm>

      <AuthFooter>
        <View className="flex-row flex-wrap items-center justify-center">
          <Text variant="muted">{t('web.auth.haveAccountPrompt')}</Text>
          <Button variant="link" className="px-2" onPress={() => router.replace('/sign-in')}>
            <Text>{t('common.auth.signIn')}</Text>
          </Button>
        </View>
      </AuthFooter>
    </AuthScreen>
  );
}

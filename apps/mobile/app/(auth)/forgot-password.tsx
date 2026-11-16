/**
 * Asks for a password-reset link. The API answers the same for an address with
 * no account, so the notice is neutral: it never says whether the address exists.
 * The mailed link is a web link: the new password is set in the browser, and the
 * reader signs in here afterwards.
 */

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { useAuth } from '@/providers/auth-provider';
import { AuthField } from '@/components/auth/auth-field';
import { AuthError, AuthStatus } from '@/components/auth/auth-notice';
import { AuthFooter, AuthForm, AuthScreen, AuthSubmit } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

const t = createTranslator(en);

export default function ForgotPasswordScreen() {
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

  if (sent) {
    return (
      <AuthScreen title={t('web.auth.forgotPasswordLink')}>
        <AuthForm>
          <AuthStatus message={t('web.auth.resetLinkSent')} />
          <Button onPress={() => router.replace('/sign-in')}>
            <Text>{t('web.auth.backToSignIn')}</Text>
          </Button>
        </AuthForm>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title={t('web.auth.forgotPasswordLink')}
      description={t('web.auth.forgotPasswordBody')}
    >
      <AuthForm>
        <AuthField
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
        {error ? <AuthError message={t(error)} /> : null}
        <AuthSubmit
          label={t('web.auth.sendResetLink')}
          busyLabel={t('web.auth.sending')}
          busy={submitting}
          onPress={() => void submit()}
        />
      </AuthForm>

      <AuthFooter>
        <Button variant="link" onPress={() => router.replace('/sign-in')}>
          <Text>{t('web.auth.backToSignIn')}</Text>
        </Button>
      </AuthFooter>
    </AuthScreen>
  );
}

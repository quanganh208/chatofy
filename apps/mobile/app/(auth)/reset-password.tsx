/**
 * Opened by `chatofy://reset-password?token=…`. Mailed links are web links now, so
 * this screen is reached only by a link opened by hand or from an older mail. Sets
 * the new password with that token; the API signs nobody in afterwards, so the next
 * step is sign-in. The token is never logged or stored.
 */

import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { authFlowFailure } from '@/auth/auth-error-message';
import { readLinkToken } from '@/auth/deep-link-token';
import { validateNewPassword } from '@/auth/register-form-state';
import { useAuth } from '@/providers/auth-provider';
import { AuthField } from '@/components/auth/auth-field';
import { AuthNextStep } from '@/components/auth/auth-next-step';
import { AuthError, AuthStatus } from '@/components/auth/auth-notice';
import { AuthFooter, AuthForm, AuthScreen, AuthSubmit } from '@/components/auth/auth-screen';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

const t = createTranslator(en);

export default function ResetPasswordScreen() {
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

  const title = t('web.auth.resetPasswordHeading');

  if (!token) {
    return (
      <AuthScreen title={title}>
        <AuthForm>
          <AuthError message={t('mobile.auth.linkMissingToken')} />
          <AuthNextStep
            label={t('web.auth.sendResetLink')}
            onPress={() => router.replace('/forgot-password')}
          />
        </AuthForm>
      </AuthScreen>
    );
  }

  if (done) {
    return (
      <AuthScreen title={title}>
        <AuthForm>
          <AuthStatus message={t('mobile.auth.resetDone')} />
          <AuthNextStep
            label={t('common.auth.signIn')}
            onPress={() => router.replace('/sign-in')}
          />
        </AuthForm>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={title} description={t('web.auth.chooseNewPassword')}>
      <AuthForm>
        <AuthField
          label={t('web.auth.newPassword')}
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
          label={t('web.auth.resetPasswordSubmit')}
          busyLabel={t('web.auth.resetting')}
          busy={submitting}
          onPress={() => void submit()}
        />
      </AuthForm>

      {error === 'common.auth.linkExpired' ? (
        <AuthFooter>
          <Button variant="link" onPress={() => router.replace('/forgot-password')}>
            <Text>{t('web.auth.sendResetLink')}</Text>
          </Button>
        </AuthFooter>
      ) : null}
    </AuthScreen>
  );
}

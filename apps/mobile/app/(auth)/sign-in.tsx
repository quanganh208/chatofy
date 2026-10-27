/**
 * Email/password sign-in against the API's `POST /auth/login`. On success the
 * session is stored in secure storage and the user goes where they were headed
 * (`?next=`), or to the conference tab. Sign-in is the one accent control here.
 *
 * Registration stays on the web: the account only exists once the mailed
 * verification link is followed, and that link opens the website.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en, type MessageKey } from '@chatofy/i18n';
import { AuthRequestError } from '@/clients/http-auth-client';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

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
      // Only an in-app path is honoured, so a crafted link cannot send the user elsewhere.
      const target = typeof next === 'string' && next.startsWith('/') ? next : '/conference';
      router.replace(target as Href);
    } catch (err) {
      setError(failureMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={[styles.title, { color: colors.text }]}>{t('mobile.auth.signInTitle')}</Text>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('common.auth.email')}
          </Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
            ]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            accessibilityLabel={t('common.auth.email')}
          />
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('common.auth.password')}
          </Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
            ]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            accessibilityLabel={t('common.auth.password')}
          />
        </View>

        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
            {t(error)}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.submit, { backgroundColor: colors.primary }]}
          onPress={() => void submit()}
          disabled={submitting}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting, busy: submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.submitText, { color: colors.primaryForeground }]}>
              {t('common.auth.signIn')}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('mobile.auth.noAccount')}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    marginBottom: space.sm,
  },
  field: {
    gap: space.xs,
  },
  label: {
    fontSize: fontSize.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.base,
  },
  error: {
    fontSize: fontSize.sm,
  },
  submit: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.sm,
  },
  submitText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  hint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});

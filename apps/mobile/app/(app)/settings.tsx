/**
 * Settings: for now, the account this phone is signed in as and the way out of
 * it. Sign out ends the refresh family server-side, so the stored token cannot
 * be replayed after it.
 */

import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function SettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, signOut } = useAuth();

  return (
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.account, { color: colors.text }]}>
        {session
          ? t('mobile.settings.signedInAs', { email: session.user.email })
          : t('mobile.settings.signedOut')}
      </Text>

      {/* Outline, not the accent: signing out is not what this screen exists for. */}
      {session ? (
        <TouchableOpacity
          style={[styles.signOut, { borderColor: colors.border }]}
          onPress={() => void signOut()}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={[styles.signOutText, { color: colors.text }]}>
            {t('common.auth.signOut')}
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.signOut, { borderColor: colors.border }]}
          onPress={() => router.push('/sign-in')}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={[styles.signOutText, { color: colors.text }]}>
            {t('mobile.home.signIn')}
          </Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  account: {
    fontSize: fontSize.base,
  },
  signOut: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  signOutText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});

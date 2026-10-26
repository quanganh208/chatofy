import { SafeAreaView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { createTranslator, en } from '@chatofy/i18n';
import { useAuth } from '@/providers/auth-provider';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function LandingScreen() {
  const router = useRouter();
  const { session, isLoading } = useAuth();

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Chatofy</Text>
      <Text style={styles.subtitle}>{t('mobile.home.comingSoon')}</Text>

      {/* The conference stack asks a signed-out user to sign in first. */}
      {isLoading ? null : (
        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.push(session ? '/(app)/conference' : '/sign-in')}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>
            {session ? t('mobile.home.joinConference') : t('mobile.home.signIn')}
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
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#000000',
  },
  subtitle: {
    fontSize: 16,
    color: '#6E6E73',
    marginTop: 8,
  },
  cta: {
    marginTop: 32,
    backgroundColor: '#000000',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

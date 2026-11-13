/**
 * Settings: the account this phone is signed in as and the way out of it, its
 * credits and plan (bought on the web, never here), then the microphone's
 * processing, with the account's synced-settings note and its reset. The screen scrolls: ten usage rows do not fit beside the rest. Sign out ends the refresh family server-side, so
 * the stored token cannot be replayed after it.
 *
 * Audio: the phone runs echo cancellation, noise suppression and gain control as
 * one chain, so there is one live switch; the other two rows show its value,
 * locked, rather than offering a choice the phone cannot apply.
 */

import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { createTranslator, en } from '@chatofy/i18n';
import { CreditsSummary } from '@/billing/credits-summary';
import { resetAccountPreferences, useAccountPreferences } from '@/preferences/account-preferences';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { useTranslateSettings } from '@/translate/use-translate-settings';

// English for now, matching the conference screens; device-locale selection is a follow-up.
const t = createTranslator(en);

export default function SettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session, signOut } = useAuth();
  const { settings, loaded, update } = useTranslateSettings();
  const { status: syncStatus } = useAccountPreferences();
  const [resetFailed, setResetFailed] = useState(false);
  const confirmReset = () =>
    Alert.alert(t('mobile.settings.sync.resetTitle'), t('mobile.settings.sync.resetBody'), [
      { text: t('web.history.cancel'), style: 'cancel' },
      {
        text: t('mobile.settings.sync.reset'),
        style: 'destructive',
        onPress: () => {
          setResetFailed(false);
          resetAccountPreferences().catch(() => setResetFailed(true));
        },
      },
    ]);
  const processing = settings.micProcessing.echoCancellation;
  const setProcessing = (on: boolean) =>
    update((current) => ({
      ...current,
      micProcessing: { echoCancellation: on, noiseSuppression: on, autoGainControl: on },
    }));
  // The native switch's on-track is the only accent on this screen.
  const trackColor = { true: colors.primary, false: colors.border };

  return (
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.fill, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.container}>
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
              {t('common.auth.signIn')}
            </Text>
          </TouchableOpacity>
        )}

        {session ? (
          <View style={styles.sync}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('mobile.settings.sync.note')}
            </Text>
            {syncStatus === 'error' ? (
              <Text accessibilityRole="alert" style={[styles.hint, { color: colors.destructive }]}>
                {t('mobile.settings.sync.error')}
              </Text>
            ) : null}
            {resetFailed ? (
              <Text accessibilityRole="alert" style={[styles.hint, { color: colors.destructive }]}>
                {t('mobile.settings.sync.resetFailed')}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[styles.signOut, { borderColor: colors.border }]}
              onPress={confirmReset}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={[styles.signOutText, { color: colors.text }]}>
                {t('mobile.settings.sync.reset')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <CreditsSummary signedIn={session !== null} />

        <View style={styles.audio}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t('common.audio.title')}
          </Text>

          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.text }]}>
              {t('common.audio.echoCancellation')}
            </Text>
            {/* Disabled until the stored value is read, so a tap cannot save over it. */}
            <Switch
              value={processing}
              onValueChange={setProcessing}
              disabled={!loaded}
              trackColor={trackColor}
              accessibilityLabel={t('common.audio.echoCancellation')}
            />
          </View>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('mobile.settings.audio.voiceProcessingHint')}
          </Text>

          {(['common.audio.noiseSuppression', 'common.audio.autoGainControl'] as const).map(
            (key) => (
              <View key={key} style={styles.row}>
                <Text style={[styles.label, { color: colors.muted }]}>{t(key)}</Text>
                <Switch
                  value={processing}
                  disabled
                  trackColor={trackColor}
                  accessibilityLabel={t(key)}
                  accessibilityHint={t('mobile.settings.audio.lockedHint')}
                />
              </View>
            ),
          )}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('mobile.settings.audio.lockedHint')}
          </Text>

          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('common.audio.recommendation')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
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
  sync: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: space.sm,
  },
  audio: {
    alignSelf: 'stretch',
    gap: space.sm,
    marginTop: space.lg,
  },
  heading: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  label: {
    flex: 1,
    fontSize: fontSize.base,
  },
  hint: {
    fontSize: fontSize.sm,
  },
});

/**
 * Which voice speaks the translation: a gender for the whole conversation, and for
 * each output language the voice the speech engine offers for it (or its default).
 * Voices are listed per language because a reversed turn of a two-way conversation
 * speaks in the voice chosen for ITS language.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { createTranslator, en } from '@chatofy/i18n';
import type { LanguageCode, VoiceGender } from '@chatofy/types';
import { space, fontSize, fontWeight } from '@chatofy/ui';
import { listVoices } from '@/clients/api-client';
import { useTheme } from '@/providers/theme-provider';
import { languageNameKey } from '@/translate/status-text';
import { BottomSheet } from '@/ui/components/bottom-sheet';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';
import { ListRow } from '@/ui/components/list-row';

const t = createTranslator(en);

interface VoiceSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The languages a translation may be spoken in during this conversation. */
  languages: readonly LanguageCode[];
  voiceGender: VoiceGender;
  voices: Partial<Record<LanguageCode, string>>;
  onGender: (gender: VoiceGender) => void;
  onVoice: (language: LanguageCode, token: string | undefined) => void;
}

export function VoiceSheet({
  visible,
  onClose,
  languages,
  voiceGender,
  voices,
  onGender,
  onVoice,
}: VoiceSheetProps) {
  const { colors } = useTheme();
  return (
    <BottomSheet
      visible={visible}
      title={t('web.translate.voice')}
      closeLabel={t('web.history.cancel')}
      onClose={onClose}
    >
      <Text style={[styles.heading, { color: colors.textSecondary }]}>
        {t('web.translate.voiceGender')}
      </Text>
      <View style={styles.genders}>
        <View style={styles.flex}>
          <GhostButton
            label={t('web.translate.voiceFemale')}
            onPress={() => onGender('female')}
            variant={voiceGender === 'female' ? 'outline' : 'link'}
          />
        </View>
        <View style={styles.flex}>
          <GhostButton
            label={t('web.translate.voiceMale')}
            onPress={() => onGender('male')}
            variant={voiceGender === 'male' ? 'outline' : 'link'}
          />
        </View>
      </View>

      {languages.map((language) => (
        <LanguageVoices
          key={language}
          language={language}
          gender={voiceGender}
          selected={voices[language]}
          onPick={(token) => onVoice(language, token)}
        />
      ))}
    </BottomSheet>
  );
}

function LanguageVoices({
  language,
  gender,
  selected,
  onPick,
}: {
  language: LanguageCode;
  gender: VoiceGender;
  selected: string | undefined;
  onPick: (token: string | undefined) => void;
}) {
  const { colors } = useTheme();
  const query = useQuery({
    queryKey: ['voices', language],
    queryFn: () => listVoices(language),
    staleTime: 5 * 60_000,
  });
  const voices = (query.data?.voices ?? []).filter((voice) => voice.gender === gender);

  return (
    <View style={styles.section}>
      <Text style={[styles.heading, { color: colors.textSecondary }]}>
        {t(languageNameKey(language))}
      </Text>
      <ListRow
        title={t('web.translate.voiceDefault')}
        selected={selected === undefined}
        onPress={() => onPick(undefined)}
      />
      {voices.map((voice) => (
        <ListRow
          key={voice.token}
          title={voice.label}
          selected={selected === voice.token}
          onPress={() => onPick(voice.token)}
        />
      ))}
      {query.isError ? (
        <InlineNotice tone="error" message={t('web.translate.voiceListFailed')} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginTop: space.md },
  genders: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  section: { gap: space.xs },
});

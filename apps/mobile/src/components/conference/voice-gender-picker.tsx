/**
 * Translated-voice selector (female / male) for the lobby.
 *
 * The voice other participants hear this speaker's translation in. The leg is
 * built with it at join and never rebuilt for a voice change, so the choice
 * lives in the lobby only. Same shape as `LanguagePicker`: no accent fill, the
 * selected segment reads via surface + border.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import type { Translate } from '@chatofy/i18n';
import type { VoiceGender } from '@chatofy/types/domain';
import { useTheme } from '@/providers/theme-provider';

interface VoiceGenderPickerProps {
  t: Translate;
  value: VoiceGender;
  onChange: (gender: VoiceGender) => void;
}

const OPTIONS: { value: VoiceGender; labelKey: Parameters<Translate>[0] }[] = [
  { value: 'female', labelKey: 'common.conference.voiceFemale' },
  { value: 'male', labelKey: 'common.conference.voiceMale' },
];

export function VoiceGenderPicker({ t, value, onChange }: VoiceGenderPickerProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('common.conference.translatedVoice')}
      </Text>
      <View style={[styles.track, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        {OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.segment,
                selected
                  ? { backgroundColor: colors.background, borderColor: colors.border }
                  : null,
              ]}
              onPress={() => {
                if (!selected) onChange(opt.value);
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: selected ? colors.text : colors.textSecondary },
                ]}
              >
                {t(opt.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {t('common.conference.translatedVoiceHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.xs,
  },
  label: {
    fontSize: fontSize.sm,
  },
  track: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.xs,
    gap: space.xs,
  },
  segment: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  segmentText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  hint: {
    fontSize: fontSize.sm,
  },
});

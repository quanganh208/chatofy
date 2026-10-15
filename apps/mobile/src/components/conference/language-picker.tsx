/**
 * Source-language selector (vi / en) for the call.
 *
 * Mirrors web's lobby SegmentedControl. The native hook reads `sourceLanguage`
 * only at `join()` and wires the translate direction from it, so there is no
 * mid-call setter; this picker therefore only takes effect BEFORE joining. The
 * call view passes `locked` once a join is in flight, after which the selected
 * language is a readout (the active control is disabled and a hint explains why).
 *
 * No accent fill — the selected segment reads via surface + border, not the
 * primary token. Leave stays the single accent control on the call screen.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import type { Translate } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';

export type SourceLanguage = 'vi' | 'en';

interface LanguagePickerProps {
  t: Translate;
  value: SourceLanguage;
  onChange: (lang: SourceLanguage) => void;
  /** When true the selection is fixed (a join is in flight / in-call); readout only. */
  locked: boolean;
}

const OPTIONS: { value: SourceLanguage; labelKey: Parameters<Translate>[0] }[] = [
  { value: 'vi', labelKey: 'mobile.conference.sourceLanguageVi' },
  { value: 'en', labelKey: 'mobile.conference.sourceLanguageEn' },
];

export function LanguagePicker({ t, value, onChange, locked }: LanguagePickerProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('mobile.conference.sourceLanguage')}
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
                if (!locked && !selected) onChange(opt.value);
              }}
              disabled={locked}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: locked }}
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
      {locked ? (
        <Text style={[styles.hint, { color: colors.muted }]}>
          {t('mobile.conference.sourceLanguageLocked')}
        </Text>
      ) : null}
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

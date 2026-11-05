/**
 * The language pair: where the speech comes from, a swap, and what it becomes.
 * Each side opens a short list. Locked while a conversation runs, because the
 * pair is stamped into the session at start.
 */

import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { createTranslator, en } from '@chatofy/i18n';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';
import {
  AUTO_DETECT,
  LANGUAGE_CODES,
  type LanguageCode,
  type SessionLanguagePair,
} from '@chatofy/types';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';
import { languageNameKey } from '@/translate/status-text';
import {
  sourceChoices,
  swapPair,
  withSource,
  withTarget,
  type SourceChoice,
} from '@/translate/translate-mode';
import { BottomSheet } from '@/ui/components/bottom-sheet';
import { ListRow } from '@/ui/components/list-row';

const t = createTranslator(en);

interface LanguageBarProps {
  pair: SessionLanguagePair;
  locked: boolean;
  onChange: (pair: SessionLanguagePair) => void;
}

type OpenSheet = 'source' | 'target' | null;

function sourceLabel(choice: SourceChoice): string {
  return choice === AUTO_DETECT ? t('web.translate.autoDetect') : t(languageNameKey(choice));
}

export function LanguageBar({ pair, locked, onChange }: LanguageBarProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState<OpenSheet>(null);
  const swapped = swapPair(pair);

  const side = (which: 'source' | 'target', label: string, caption: string) => (
    <TouchableOpacity
      style={[styles.side, { borderColor: colors.border }]}
      disabled={locked}
      onPress={() => setOpen(which)}
      accessibilityRole="button"
      accessibilityLabel={`${caption}: ${label}`}
      accessibilityState={{ disabled: locked }}
    >
      <Text style={[styles.caption, { color: colors.textSecondary }]}>{caption}</Text>
      <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.row}>
      {side('source', sourceLabel(pair.source), t('web.translate.languagePairSource'))}
      <TouchableOpacity
        style={styles.swap}
        disabled={locked || swapped === null}
        onPress={() => swapped && onChange(swapped)}
        accessibilityRole="button"
        accessibilityLabel={
          swapped
            ? t('web.translate.languagePairSwap', {
                from: t(languageNameKey(pair.target)),
                to: sourceLabel(pair.source),
              })
            : t('web.translate.languagePairSwapDetect')
        }
        accessibilityState={{ disabled: locked || swapped === null }}
      >
        <Ionicons
          name="swap-horizontal"
          size={22}
          color={locked || swapped === null ? colors.muted : colors.text}
        />
      </TouchableOpacity>
      {side('target', t(languageNameKey(pair.target)), t('web.translate.languagePairTarget'))}

      <BottomSheet
        visible={open === 'source'}
        title={t('web.translate.languagePairSource')}
        closeLabel={t('web.history.cancel')}
        onClose={() => setOpen(null)}
      >
        {sourceChoices(pair.target).map((choice) => (
          <ListRow
            key={choice}
            title={sourceLabel(choice)}
            selected={choice === pair.source}
            onPress={() => {
              onChange(withSource(pair, choice));
              setOpen(null);
            }}
          />
        ))}
      </BottomSheet>

      <BottomSheet
        visible={open === 'target'}
        title={t('web.translate.languagePairTarget')}
        closeLabel={t('web.history.cancel')}
        onClose={() => setOpen(null)}
      >
        {LANGUAGE_CODES.map((code: LanguageCode) => (
          <ListRow
            key={code}
            title={t(languageNameKey(code))}
            selected={code === pair.target}
            onPress={() => {
              onChange(withTarget(pair, code));
              setOpen(null);
            }}
          />
        ))}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  side: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 56,
    justifyContent: 'center',
  },
  caption: { fontSize: fontSize.xs, textTransform: 'uppercase' },
  label: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  swap: {
    padding: space.sm,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

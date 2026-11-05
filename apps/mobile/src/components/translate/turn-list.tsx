/**
 * The conversation so far: each turn's translation as the largest thing on it,
 * its source underneath in the secondary colour, with a short language tag. The
 * newest line stays in view while the user has not scrolled away from the end.
 */

import { useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { createTranslator, en } from '@chatofy/i18n';
import { space, fontSize, fontWeight } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';
import { languageNameKey } from '@/translate/status-text';
import type { TurnRow } from '@/translate/turn-display';

const t = createTranslator(en);

/** How near the end still counts as at it, in points. */
const AT_END_SLOP = 48;

interface TurnListProps {
  rows: TurnRow[];
  emptyText: string;
}

export function TurnList({ rows, emptyText }: TurnListProps) {
  const { colors } = useTheme();
  const listRef = useRef<FlatList<TurnRow>>(null);
  // Only a drag unpins: the list's own scroll to the end lags new content, and must not.
  const pinnedRef = useRef(true);

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={(row) => row.key}
      onContentSizeChange={() => {
        if (pinnedRef.current) listRef.current?.scrollToEnd({ animated: true });
      }}
      onScrollBeginDrag={() => {
        pinnedRef.current = false;
      }}
      onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
        const bottom = contentOffset.y + layoutMeasurement.height;
        if (bottom >= contentSize.height - AT_END_SLOP) pinnedRef.current = true;
      }}
      scrollEventThrottle={100}
      contentContainerStyle={rows.length === 0 ? styles.emptyBox : styles.list}
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{emptyText}</Text>
      }
      renderItem={({ item }) => (
        <View style={[styles.turn, { borderBottomColor: colors.border }]}>
          {item.sourceLanguage ? (
            <Text
              style={[styles.tag, { color: colors.textSecondary }]}
              accessibilityLabel={t('web.translate.turnLanguage', {
                language: t(languageNameKey(item.sourceLanguage)),
              })}
            >
              {item.sourceLanguage.toUpperCase()}
            </Text>
          ) : null}
          {item.translation ? (
            <Text
              style={[
                styles.translation,
                { color: item.live ? colors.textSecondary : colors.text },
              ]}
            >
              {item.translation}
            </Text>
          ) : null}
          <Text style={[styles.source, { color: colors.textSecondary }]}>{item.sourceText}</Text>
          {item.unheard ? (
            <Text style={[styles.unheard, { color: colors.textSecondary }]}>
              {t('mobile.translate.unheard')}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: space.md },
  emptyBox: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', fontSize: fontSize.base, paddingHorizontal: space.lg },
  turn: { paddingVertical: space.md, gap: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  tag: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  translation: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  source: { fontSize: fontSize.base },
  unheard: { fontSize: fontSize.sm, fontStyle: 'italic' },
});

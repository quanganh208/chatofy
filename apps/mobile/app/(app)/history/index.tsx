/**
 * Past conversations, newest first, with search. Keyset-paged: the API hands back a
 * cursor with each page and the list asks for the next one near its end, so a
 * conversation added or deleted meanwhile cannot skip or repeat a row. This screen
 * spends no accent: its destinations are already in the tab bar.
 */

import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createTranslator, en } from '@chatofy/i18n';
import type { ConversationSummary } from '@chatofy/types';
import { fontSize, space } from '@chatofy/ui';
import { listConversations } from '@/clients/api-client';
import { durationMinutes, languageLine, searchTerm, titleOf } from '@/history/history-format';
import { useDebouncedValue } from '@/history/use-debounced-value';
import { useTheme } from '@/providers/theme-provider';
import { languageNameKey } from '@/translate/status-text';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';
import { ListRow } from '@/ui/components/list-row';
import { TextField } from '@/ui/components/text-field';

const t = createTranslator(en);
const PAGE_SIZE = 20;

/** "Vietnamese → English · 12 min · 8 lines": the line under a conversation's title. */
function describe(conversation: ConversationSummary): string {
  const line = languageLine(conversation.languages);
  const to = t(languageNameKey(line.to));
  const languages =
    line.kind === 'detect'
      ? `${t('web.history.autoDetect')} → ${to}`
      : `${t(languageNameKey(line.from ?? line.to))} → ${to}`;
  const minutes = durationMinutes(conversation);
  const turns =
    conversation.turnCount === 1
      ? t('web.history.turnCountOne')
      : t('web.history.turnCount', { count: String(conversation.turnCount) });
  return [
    languages,
    minutes > 0 ? t('web.history.duration', { minutes: String(minutes) }) : null,
    turns,
  ]
    .filter(Boolean)
    .join(' · ');
}

export default function HistoryScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [raw, setRaw] = useState('');
  // A request when the user pauses, not one per key.
  const term = searchTerm(useDebouncedValue(raw, 350));

  const query = useInfiniteQuery({
    queryKey: ['conversations', term],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listConversations({ limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}), q: term }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const conversations = query.data?.pages.flatMap((page) => page.conversations) ?? [];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.search}>
        <TextField
          label={t('web.history.searchLabel')}
          value={raw}
          onChangeText={setRaw}
          placeholder={t('web.history.searchPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {query.isPending ? (
        <ActivityIndicator style={styles.center} color={colors.textSecondary} />
      ) : query.isError && conversations.length === 0 ? (
        <View style={styles.message}>
          <InlineNotice tone="error" message={t('web.history.loadFailed')} />
          <GhostButton label={t('web.history.retry')} onPress={() => void query.refetch()} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.conversationId}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => void query.refetch()}
              tintColor={colors.textSecondary}
            />
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            <View style={styles.message}>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                {term ? t('web.history.searchNoResults') : t('web.history.empty')}
              </Text>
              {term ? (
                <GhostButton
                  variant="link"
                  label={t('web.history.clearSearch')}
                  onPress={() => setRaw('')}
                />
              ) : (
                <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                  {t('web.history.emptyBody')}
                </Text>
              )}
            </View>
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : query.isFetchNextPageError ? (
              // The rows already loaded stay exactly where they are.
              <GhostButton
                label={t('web.history.loadMore')}
                onPress={() => void query.fetchNextPage()}
              />
            ) : undefined
          }
          renderItem={({ item }) => (
            <ListRow
              title={titleOf(item) ?? t('web.history.untitled')}
              subtitle={describe(item)}
              onPress={() =>
                router.push({
                  pathname: '/history/[conversationId]',
                  params: { conversationId: item.conversationId },
                })
              }
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { paddingHorizontal: space.lg, paddingTop: space.md },
  list: { paddingHorizontal: space.lg, paddingBottom: space.lg, flexGrow: 1 },
  center: { marginTop: space.xl },
  message: { gap: space.md, paddingVertical: space.xl, alignItems: 'stretch' },
  emptyTitle: { fontSize: fontSize.md, textAlign: 'center' },
  emptyBody: { fontSize: fontSize.base, textAlign: 'center' },
});

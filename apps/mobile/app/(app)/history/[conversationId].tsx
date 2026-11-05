/**
 * One stored conversation, read from the top: each line's translation as the
 * largest thing on it, with what was said beneath. The only action is deleting it,
 * which asks first and is not an accent control.
 */

import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTranslator, en } from '@chatofy/i18n';
import { fontSize, fontWeight, space } from '@chatofy/ui';
import { deleteConversation, getConversation } from '@/clients/api-client';
import { detailTurns, titleOf } from '@/history/history-format';
import { useTheme } from '@/providers/theme-provider';
import { languageNameKey } from '@/translate/status-text';
import { GhostButton } from '@/ui/components/ghost-button';
import { InlineNotice } from '@/ui/components/inline-notice';

const t = createTranslator(en);

export default function ConversationDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const [deleteFailed, setDeleteFailed] = useState(false);

  const query = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: typeof conversationId === 'string' && conversationId.length > 0,
  });

  const remove = useMutation({
    mutationFn: () => deleteConversation(conversationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      router.back();
    },
    onError: () => setDeleteFailed(true),
  });

  function confirmDelete() {
    setDeleteFailed(false);
    Alert.alert(t('web.history.delete'), t('web.history.deleteConfirm'), [
      { text: t('web.history.cancel'), style: 'cancel' },
      { text: t('web.history.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ]);
  }

  if (query.isPending) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.screen, styles.pad, { backgroundColor: colors.background }]}>
        <InlineNotice tone="error" message={t('web.history.notFound')} />
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          {t('web.history.notFoundBody')}
        </Text>
        <GhostButton label={t('web.history.retry')} onPress={() => void query.refetch()} />
      </View>
    );
  }

  const { conversation } = query.data;
  const turns = detailTurns(conversation.turns);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: titleOf(conversation) ?? t('web.history.untitled') }} />
      <FlatList
        data={turns}
        keyExtractor={(turn) => String(turn.position)}
        contentContainerStyle={styles.pad}
        renderItem={({ item }) => (
          <View style={[styles.turn, { borderBottomColor: colors.border }]}>
            {item.sourceLanguage || item.speakerLabel ? (
              <Text style={[styles.tag, { color: colors.textSecondary }]}>
                {[
                  item.sourceLanguage ? t(languageNameKey(item.sourceLanguage)) : null,
                  item.speakerLabel,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}
            {item.translation ? (
              <Text style={[styles.translation, { color: colors.text }]}>{item.translation}</Text>
            ) : null}
            <Text style={[styles.source, { color: colors.textSecondary }]}>{item.sourceText}</Text>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            {deleteFailed ? (
              <InlineNotice tone="error" message={t('web.history.deleteFailed')} />
            ) : null}
            <GhostButton
              destructive
              label={remove.isPending ? t('web.history.deleting') : t('web.history.delete')}
              onPress={confirmDelete}
              disabled={remove.isPending}
            />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  pad: { padding: space.lg, gap: space.md },
  body: { fontSize: fontSize.base },
  turn: { paddingVertical: space.md, gap: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  tag: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  translation: { fontSize: fontSize.md, fontWeight: fontWeight.medium },
  source: { fontSize: fontSize.base },
  footer: { marginTop: space.lg, gap: space.sm },
});

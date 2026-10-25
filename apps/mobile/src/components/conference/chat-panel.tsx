/**
 * A modal sheet for in-meeting chat — a scrollable message list (newest last)
 * plus a text composer. Pure readout + input, no accent: the send control is a
 * ghost/outline button so the call screen's single accent control stays Leave.
 * Mirrors the transcript-sheet pattern (Modal + bottom sheet).
 *
 * Each message arrives already in this client's chosen language (the gateway
 * translates per recipient). Own messages are distinguished by `mySocketId`.
 * This component renders what it is given and sends drafts back via `onSend`;
 * it owns no chat state beyond the in-progress draft.
 */

import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import type { Translate } from '@chatofy/i18n';
import type { ConferenceChatMessage } from '@chatofy/types/events';
import { useTheme } from '@/providers/theme-provider';

interface ChatPanelProps {
  t: Translate;
  visible: boolean;
  messages: ConferenceChatMessage[];
  mySocketId: string | null;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function ChatPanel({ t, visible, messages, mySocketId, onSend, onClose }: ChatPanelProps) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState('');

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  }

  const canSend = draft.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{t('mobile.conference.chat')}</Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {messages.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                {t('mobile.conference.chatEmpty')}
              </Text>
            ) : (
              messages.map((m) => {
                const isOwn = m.socketId === mySocketId;
                return (
                  <View key={m.id} style={styles.message}>
                    <Text
                      style={[styles.sender, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {isOwn ? `${m.displayName} •` : m.displayName}
                    </Text>
                    <Text style={[styles.text, { color: colors.text }]}>{m.text}</Text>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              style={[
                styles.input,
                { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
              ]}
              value={draft}
              onChangeText={setDraft}
              placeholder={t('mobile.conference.chatPlaceholder')}
              placeholderTextColor={colors.muted}
              onSubmitEditing={submit}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <TouchableOpacity
              style={[styles.send, { borderColor: colors.border }, !canSend && styles.sendDisabled]}
              onPress={submit}
              disabled={!canSend}
              activeOpacity={0.7}
              accessibilityRole="button"
            >
              <Text style={[styles.sendText, { color: colors.text }]}>
                {t('mobile.conference.chatSend')}
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.close, { borderColor: colors.border }]}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.closeText, { color: colors.text }]}>
              {t('mobile.conference.hideChat')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    maxHeight: '70%',
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    marginBottom: space.md,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: space.md,
  },
  empty: {
    fontSize: fontSize.base,
    textAlign: 'center',
    paddingVertical: space.lg,
  },
  message: {
    gap: space.xs,
  },
  sender: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  text: {
    fontSize: fontSize.base,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.base,
  },
  send: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  sendDisabled: {
    opacity: 0.5,
  },
  sendText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  close: {
    marginTop: space.md,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
  },
  closeText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
});

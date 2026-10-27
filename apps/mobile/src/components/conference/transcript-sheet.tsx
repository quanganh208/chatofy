/**
 * A modal sheet showing the call's transcript — one line per captured turn,
 * newest last, scrollable. Pure readout, no accent; dismiss is a ghost control.
 * Mirrors the participant-sheet pattern (Modal + bottom sheet).
 *
 * The call view owns accumulation: subtitles in the hook are transient (replaced
 * on partial, cleared on final/timeout), so the view records each speaker's turn
 * into the `entries` list and passes it here. This component renders whatever it
 * is given and decides nothing about the pipeline.
 */

import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import type { Translate } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';

export interface TranscriptEntry {
  /** Stable key for the turn — `${speakerSocketId}:${turnId}` from the hook. */
  id: string;
  speaker: string;
  text: string;
}

interface TranscriptSheetProps {
  t: Translate;
  visible: boolean;
  entries: TranscriptEntry[];
  onClose: () => void;
}

export function TranscriptSheet({ t, visible, entries, onClose }: TranscriptSheetProps) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{t('common.transcript')}</Text>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {entries.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textSecondary }]}>
                {t('mobile.conference.transcriptEmpty')}
              </Text>
            ) : (
              entries.map((entry) => (
                <View key={entry.id} style={styles.entry}>
                  <Text style={[styles.speaker, { color: colors.textSecondary }]} numberOfLines={1}>
                    {entry.speaker}
                  </Text>
                  <Text style={[styles.text, { color: colors.text }]}>{entry.text}</Text>
                </View>
              ))
            )}
          </ScrollView>
          <TouchableOpacity
            style={[styles.close, { borderColor: colors.border }]}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.closeText, { color: colors.text }]}>
              {t('mobile.conference.hideTranscript')}
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
  entry: {
    gap: space.xs,
  },
  speaker: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  text: {
    fontSize: fontSize.base,
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

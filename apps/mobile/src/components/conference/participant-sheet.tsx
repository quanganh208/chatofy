/**
 * A modal sheet listing everyone in the call — the local user plus each remote peer,
 * with muted/camera-off readouts. Pure list, no accent; dismiss is a ghost control.
 */

import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import type { Translate } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';
import type { PeerState } from '@/conference/use-conference-native';

interface ParticipantSheetProps {
  t: Translate;
  visible: boolean;
  localLabel: string;
  localMuted: boolean;
  localVideoEnabled: boolean;
  peers: Map<string, PeerState>;
  onClose: () => void;
}

export function ParticipantSheet({
  t,
  visible,
  localLabel,
  localMuted,
  localVideoEnabled,
  peers,
  onClose,
}: ParticipantSheetProps) {
  const { colors } = useTheme();
  const peerEntries = [...peers.entries()];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>
            {t('common.conference.rosterTitle')}
          </Text>
          <ScrollView style={styles.list}>
            <Row
              label={`${localLabel} · ${t('common.conference.you')}`}
              muted={localMuted}
              videoEnabled={localVideoEnabled}
            />
            {peerEntries.map(([socketId, peer]) => (
              <Row
                key={socketId}
                label={peer.displayName}
                muted={peer.muted}
                videoEnabled={peer.videoEnabled}
              />
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.close, { borderColor: colors.border }]}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.closeText, { color: colors.text }]}>
              {t('common.conference.hideRoster')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  label,
  muted,
  videoEnabled,
}: {
  label: string;
  muted: boolean;
  videoEnabled: boolean;
}) {
  const { colors } = useTheme();
  const readouts: string[] = [];
  if (muted) readouts.push('•');
  if (!videoEnabled) readouts.push('◦');
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      {readouts.length > 0 ? (
        <Text style={[styles.rowReadout, { color: colors.textSecondary }]}>
          {readouts.join(' ')}
        </Text>
      ) : null}
    </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: fontSize.base,
  },
  rowReadout: {
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

/**
 * One video tile: a peer's (or the local) stream rendered via RTCView, with a name
 * label and muted/camera-off readouts. No accent fill — the only accent on the call
 * screen is the Leave button.
 */

import { View, Text, StyleSheet } from 'react-native';
import { RTCView, type MediaStream } from 'react-native-webrtc';
import { space, radius, fontSize, fontWeight, overlay, color } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';
import { SubtitleOverlay } from './subtitle-overlay';

interface ParticipantTileProps {
  stream: MediaStream;
  label: string;
  /** Mirror the local preview; remote tiles are not mirrored. */
  mirror?: boolean;
  muted?: boolean;
  videoEnabled?: boolean;
  /** Current translated caption for this tile; undefined when none is active. */
  subtitle?: string;
  /** Show the `translating…` badge on this tile (local tile only). */
  translating?: boolean;
  /** Localised badge text; required when `translating` is true. */
  translatingLabel?: string;
}

export function ParticipantTile({
  stream,
  label,
  mirror = false,
  muted = false,
  videoEnabled = true,
  subtitle,
  translating = false,
  translatingLabel = '',
}: ParticipantTileProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {videoEnabled ? (
        <RTCView
          streamURL={stream.toURL()}
          style={styles.video}
          objectFit="cover"
          mirror={mirror}
        />
      ) : (
        <View style={[styles.video, styles.videoOff, { backgroundColor: colors.surface }]}>
          <Text style={[styles.offText, { color: colors.textSecondary }]}>{label}</Text>
        </View>
      )}

      {/* Translating badge — top-right readout, no accent fill. */}
      {translating ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{translatingLabel}</Text>
        </View>
      ) : null}

      {/* Subtitle overlay — bottom-center, above the name label. */}
      <SubtitleOverlay subtitle={subtitle} />

      <View style={styles.overlay} pointerEvents="none">
        <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        {muted ? <Text style={[styles.readout, { color: colors.textSecondary }]}>•</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  videoOff: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  offText: {
    fontSize: fontSize.sm,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  badge: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    backgroundColor: overlay.bg,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  badgeText: {
    color: color.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  label: {
    flexShrink: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  readout: {
    fontSize: fontSize.sm,
  },
});

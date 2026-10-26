/**
 * The in-call control bar: mic toggle, camera toggle, participants button, and the
 * single accent action — Leave. Per the design budget, Leave is the only filled
 * control on this screen; mic/cam/participants are ghost/outline toggles and readouts.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import type { Translate } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';

interface CallControlBarProps {
  t: Translate;
  muted: boolean;
  videoEnabled: boolean;
  participantCount: number;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onShowParticipants: () => void;
  onLeave: () => void;
}

export function CallControlBar({
  t,
  muted,
  videoEnabled,
  participantCount,
  onToggleMute,
  onToggleVideo,
  onShowParticipants,
  onLeave,
}: CallControlBarProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <GhostToggle
        label={muted ? t('mobile.conference.unmuteMic') : t('mobile.conference.muteMic')}
        active={!muted}
        onPress={onToggleMute}
      />
      <GhostToggle
        label={
          videoEnabled ? t('mobile.conference.disableCamera') : t('mobile.conference.enableCamera')
        }
        active={videoEnabled}
        onPress={onToggleVideo}
      />
      <GhostToggle
        label={`${t('mobile.conference.participants')} (${participantCount})`}
        active={false}
        onPress={onShowParticipants}
      />
      <TouchableOpacity
        style={[styles.leave, { backgroundColor: colors.destructive }]}
        onPress={onLeave}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <Text style={[styles.leaveText, { color: colors.primaryForeground }]}>
          {t('mobile.conference.leave')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** A ghost (outline) toggle — no fill. `active` only shifts the border/text weight. */
function GhostToggle({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.ghost, { borderColor: active ? colors.text : colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      <Text
        style={[styles.ghostText, { color: active ? colors.text : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
  },
  ghost: {
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  ghostText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  leave: {
    flexGrow: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    alignItems: 'center',
  },
  leaveText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});

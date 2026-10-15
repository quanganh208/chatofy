/**
 * Subtitle overlay rendered on top of a video tile.
 *
 * Shows the speaker's current caption from the translation pipeline. The hook
 * (use-conference-native.ts) owns the state machine: partial frames replace the
 * text in place, a final frame or a 4 s timeout clears it to `undefined`. This
 * component is a pure readout of `peer.subtitle` — when the hook clears it, the
 * caption disappears, so a turn whose final subtitle never arrives cannot stick.
 *
 * No accent fill — the only accent control on the call screen is Leave. The scrim
 * is the shared `overlay` token: translucent dark over arbitrary video, the exact
 * situation that token exists for, so it is theme-independent on purpose. The
 * caption text is the dark palette's on-dark text token, which the scrim is solved
 * against (matching web's white-on-black/80 subtitle).
 */

import { View, Text, StyleSheet } from 'react-native';
import { space, radius, fontSize, fontWeight, overlay, color } from '@chatofy/ui';

interface SubtitleOverlayProps {
  /** Current caption for the tile; undefined when none is active. */
  subtitle: string | undefined;
}

export function SubtitleOverlay({ subtitle }: SubtitleOverlayProps) {
  if (!subtitle) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.text} numberOfLines={3}>
        {subtitle}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: space.lg,
    alignItems: 'center',
  },
  text: {
    backgroundColor: overlay.bg,
    color: color.text,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    overflow: 'hidden',
  },
});

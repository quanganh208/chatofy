import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}

/**
 * The one accent-filled control on a screen. A second one on the same screen
 * state breaks the accent budget in docs/design-guidelines.md — use
 * `GhostButton` for everything else.
 */
export function PrimaryButton({
  label,
  onPress,
  busy = false,
  disabled = false,
}: PrimaryButtonProps) {
  const { colors } = useTheme();
  const inactive = busy || disabled;
  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: colors.primary }, disabled && styles.dim]}
      onPress={onPress}
      disabled={inactive}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
    >
      {busy ? (
        <ActivityIndicator color={colors.primaryForeground} />
      ) : (
        <Text style={[styles.text, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  // Disabled by state, not by a composited opacity over text that must stay readable.
  dim: { opacity: 0.6 },
  text: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});

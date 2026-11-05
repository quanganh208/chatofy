import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

interface GhostButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `outline` draws an edge; `link` is bare text for a quiet secondary action. */
  variant?: 'outline' | 'link';
  /** Destructive actions read as the live colour, never as the accent fill. */
  destructive?: boolean;
}

/** A secondary action: outline or bare text, never an accent fill. */
export function GhostButton({
  label,
  onPress,
  disabled = false,
  variant = 'outline',
  destructive = false,
}: GhostButtonProps) {
  const { colors } = useTheme();
  const tone = destructive ? colors.destructive : colors.text;
  return (
    <TouchableOpacity
      style={[
        styles.button,
        variant === 'outline' && { borderWidth: 1, borderColor: colors.border },
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.text, { color: tone }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  text: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
});

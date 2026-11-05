import { StyleSheet, Text, View } from 'react-native';
import { space, radius, fontSize } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

interface InlineNoticeProps {
  message: string;
  /** `error` is announced to screen readers as an alert; `info` is plain text. */
  tone?: 'error' | 'info';
}

/** A short line of feedback under a form or above a list; text on the ground, not a card. */
export function InlineNotice({ message, tone = 'info' }: InlineNoticeProps) {
  const { colors } = useTheme();
  const isError = tone === 'error';
  return (
    <View
      style={[styles.box, { borderColor: isError ? colors.destructive : colors.border }]}
      accessibilityRole={isError ? 'alert' : undefined}
    >
      <Text style={[styles.text, { color: isError ? colors.destructive : colors.text }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderLeftWidth: 3,
    paddingLeft: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.sm,
  },
  text: { fontSize: fontSize.sm },
});

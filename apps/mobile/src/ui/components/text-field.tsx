import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Text } from '@/components/ui/text';
import { space, radius, fontSize } from '@chatofy/ui';
import { cn } from '@/lib/utils';
import { useTheme } from '@/providers/theme-provider';

interface TextFieldProps extends TextInputProps {
  label: string;
}

/**
 * A labelled single-line input; the label doubles as the accessibility label.
 * The typed text is Be Vietnam Pro (`font-sans`), the face its label is in.
 */
export function TextField({ label, style, className, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        className={cn('font-sans', className)}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          { borderColor: colors.border, color: colors.text, backgroundColor: colors.surface },
          style,
        ]}
        {...input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.xs },
  label: { fontSize: fontSize.sm },
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.base,
  },
});

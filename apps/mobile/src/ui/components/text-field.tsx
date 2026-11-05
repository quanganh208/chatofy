import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { space, radius, fontSize } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

interface TextFieldProps extends TextInputProps {
  label: string;
}

/** A labelled single-line input; the label doubles as the accessibility label. */
export function TextField({ label, style, ...input }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
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

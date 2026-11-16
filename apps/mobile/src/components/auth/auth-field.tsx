/**
 * A labelled single-line field: `Label` over `Input`.
 *
 * The label names the input for assistive tech twice over — `aria-labelledby`
 * pointing at the label, and the label text as `accessibilityLabel` for the
 * readers that ignore the relation.
 */
import { useId } from 'react';
import { View, type TextInputProps } from 'react-native';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AuthFieldProps extends Omit<TextInputProps, 'accessibilityLabel'> {
  label: string;
}

export function AuthField({ label, ...input }: AuthFieldProps) {
  const labelId = `field-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <View className="gap-2">
      <Label nativeID={labelId}>{label}</Label>
      <Input aria-labelledby={labelId} accessibilityLabel={label} {...input} />
    </View>
  );
}

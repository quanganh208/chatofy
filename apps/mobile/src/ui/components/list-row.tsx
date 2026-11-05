import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { space, fontSize, fontWeight } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Short trailing text such as a time or a count. */
  trailing?: string;
  onPress?: () => void;
  selected?: boolean;
}

/** One line of a list on the page ground, separated by a hairline rather than boxed. */
export function ListRow({ title, subtitle, trailing, onPress, selected = false }: ListRowProps) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ selected }}
    >
      <View style={styles.main}>
        <Text
          style={[
            styles.title,
            { color: colors.text, fontWeight: selected ? fontWeight.semibold : fontWeight.regular },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text style={[styles.trailing, { color: colors.textSecondary }]}>{trailing}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  main: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.base },
  subtitle: { fontSize: fontSize.sm },
  trailing: { fontSize: fontSize.sm },
});

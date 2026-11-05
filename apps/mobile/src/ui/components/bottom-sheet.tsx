import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { space, radius, fontSize, fontWeight } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';
import { GhostButton } from './ghost-button';

interface BottomSheetProps {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A panel rising from the bottom edge for a short pick-list. It sits on the ground
 * colour with an edge rather than a shadow, per the elevation rules in the design
 * guidelines, and a tap on the dimmed area behind it closes it.
 */
export function BottomSheet({ visible, title, closeLabel, onClose, children }: BottomSheetProps) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={closeLabel} />
      <SafeAreaView
        edges={['bottom']}
        style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {title}
          </Text>
          <GhostButton variant="link" label={closeLabel} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});

import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { space } from '@chatofy/ui';
import { useTheme } from '@/providers/theme-provider';

interface ScreenProps {
  children: ReactNode;
  /** Scrolls the content; a screen that owns its own list passes false. */
  scroll?: boolean;
  /** Centres the content vertically, for short forms. */
  centered?: boolean;
  /** Tab screens already sit under a header or above a tab bar. */
  edges?: Edge[];
}

/** The ground every screen sits on: theme background, safe area, keyboard avoidance. */
export function Screen({ children, scroll = true, centered = false, edges }: ScreenProps) {
  const { colors } = useTheme();

  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, centered && styles.centered]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.fill, centered && styles.centered]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.md },
  centered: { justifyContent: 'center' },
});

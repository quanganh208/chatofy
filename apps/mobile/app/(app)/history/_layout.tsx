import { Stack } from 'expo-router';
import { createTranslator, en } from '@chatofy/i18n';
import { useTheme } from '@/providers/theme-provider';

const t = createTranslator(en);

/**
 * The list and a conversation opened from it, in one stack under the History tab,
 * so opening one pushes over the list and back returns to it with its search kept.
 */
export default function HistoryLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('web.chrome.navHistory') }} />
      <Stack.Screen name="[conversationId]" options={{ title: '' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';

/**
 * Stacks the conference lobby (`index`) and the call view (`[roomId]`) under the
 * single "Conference" tab, so `[roomId]` pushes over the lobby rather than becoming
 * its own tab. Headers are owned by the screens.
 */
export default function ConferenceLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[roomId]" />
    </Stack>
  );
}

import { Redirect, Stack } from 'expo-router';

/**
 * Stacks the conference lobby (`index`) and the call view (`[roomId]`) under the
 * single "Conference" tab, so `[roomId]` pushes over the lobby rather than becoming
 * its own tab. Headers are owned by the screens.
 *
 * Development builds only: the call signs in with bench credentials until the
 * mobile app has a real AuthClient, so a release build sends any deep link into
 * the conference stack back to the landing screen instead of rendering it.
 */
export default function ConferenceLayout() {
  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[roomId]" />
    </Stack>
  );
}

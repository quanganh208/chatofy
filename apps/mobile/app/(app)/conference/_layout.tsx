import { Stack } from 'expo-router';

/**
 * Stacks the conference lobby (`index`) and the call view (`[roomId]`) under the
 * single "Conference" tab, so `[roomId]` pushes over the lobby rather than becoming
 * its own tab. Headers are owned by the screens.
 *
 * Signed-in only: the socket and the REST lobby need a bearer token. The tab
 * layout one level up sends a signed-out user (or a refresh the API refuses
 * mid-call) to sign in, then back to where they were.
 */
export default function ConferenceLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[roomId]" />
      <Stack.Screen name="ended" />
    </Stack>
  );
}

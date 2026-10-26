import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/providers/auth-provider';

/**
 * Stacks the conference lobby (`index`) and the call view (`[roomId]`) under the
 * single "Conference" tab, so `[roomId]` pushes over the lobby rather than becoming
 * its own tab. Headers are owned by the screens.
 *
 * Signed-in only: the socket and the REST lobby need a bearer token. Signing out —
 * or a refresh the API refuses mid-call — sends the user to sign in, then back to
 * the lobby.
 *
 * The stack stays mounted and the redirect is an effect. Rendering `<Redirect>` in
 * its place swaps the native stack out from under a mounted tab, which Fabric
 * refuses ("addViewAt: View already has a parent") and the app crashes.
 */
export default function ConferenceLayout() {
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const signedOut = !isLoading && !session;

  useEffect(() => {
    if (signedOut) router.replace({ pathname: '/sign-in', params: { next: '/conference' } });
  }, [signedOut, router]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[roomId]" />
      <Stack.Screen name="ended" />
    </Stack>
  );
}

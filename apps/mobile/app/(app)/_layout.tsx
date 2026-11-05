import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useEffect } from 'react';
import { Tabs, usePathname, useRouter, type Href } from 'expo-router';
import { createTranslator, en } from '@chatofy/i18n';
import { appGuardRedirect } from '@/auth/route-guard';
import { useAuth } from '@/providers/auth-provider';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';

// English for now, matching the other screens; device-locale selection is a follow-up.
const t = createTranslator(en);

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type IoniconColor = ComponentProps<typeof Ionicons>['color'];

/** Build a tabBarIcon render fn so each tab shows a real glyph, not a missing-glyph box. */
function tabIcon(name: IoniconName) {
  const Icon = ({ color, size }: { color: ColorValue; size: number }) => (
    // The tab bar hands over React Native's full ColorValue (null and processed
    // numbers included). The icon renders it through <Text>, which takes all of
    // those; only the icon set's own prop type is narrower.
    <Ionicons name={name} color={color as IoniconColor} size={size} />
  );
  Icon.displayName = `TabIcon(${name})`;
  return Icon;
}

export default function AppLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { session, isLoading } = useAuth();

  // An effect rather than `<Redirect>`: swapping the tab navigator out from
  // under a mounted tab crashes Fabric ("addViewAt: View already has a parent").
  // This also covers a sign-out, or a refresh the API refuses, while a screen is open.
  const redirect = appGuardRedirect({ isLoading, signedIn: session !== null, pathname });
  useEffect(() => {
    if (redirect) router.replace(redirect as Href);
  }, [redirect, router]);

  return (
    <Tabs>
      <Tabs.Screen
        name="translate"
        options={{ title: t('mobile.tabs.translate'), tabBarIcon: tabIcon('mic-outline') }}
      />
      <Tabs.Screen
        name="history"
        // The history stack draws its own headers (list, then a conversation).
        options={{
          title: t('web.chrome.navHistory'),
          headerShown: false,
          tabBarIcon: tabIcon('time-outline'),
        }}
      />
      <Tabs.Screen
        name="conference"
        options={{ title: t('mobile.tabs.conference'), tabBarIcon: tabIcon('videocam-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('mobile.tabs.settings'), tabBarIcon: tabIcon('settings-outline') }}
      />
    </Tabs>
  );
}

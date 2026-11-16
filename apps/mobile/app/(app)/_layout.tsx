import { useEffect } from 'react';
import type { ColorValue } from 'react-native';
import { Tabs, usePathname, useRouter, type Href } from 'expo-router';
import { createTranslator, en } from '@chatofy/i18n';
import { appGuardRedirect } from '@/auth/route-guard';
import { useAuth } from '@/providers/auth-provider';
import { Clock, Mic, Settings, Video, type LucideIcon } from 'lucide-react-native';

// English for now, matching the other screens; device-locale selection is a follow-up.
const t = createTranslator(en);

/** Build a tabBarIcon render fn from a lucide glyph, the icon set web draws too. */
function tabIcon(Glyph: LucideIcon) {
  const Icon = ({ color, size }: { color: ColorValue; size: number }) => (
    // The tab bar hands over React Native's full ColorValue; it is always a
    // palette string here, and lucide's prop type is only the string half.
    <Glyph color={color as string} size={size} />
  );
  Icon.displayName = `TabIcon(${Glyph.displayName ?? 'icon'})`;
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
        options={{ title: t('common.nav.translate'), tabBarIcon: tabIcon(Mic) }}
      />
      <Tabs.Screen
        name="history"
        // The history stack draws its own headers (list, then a conversation).
        options={{
          title: t('web.chrome.navHistory'),
          headerShown: false,
          tabBarIcon: tabIcon(Clock),
        }}
      />
      <Tabs.Screen
        name="conference"
        options={{ title: t('mobile.tabs.conference'), tabBarIcon: tabIcon(Video) }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('common.nav.settings'), tabBarIcon: tabIcon(Settings) }}
      />
    </Tabs>
  );
}

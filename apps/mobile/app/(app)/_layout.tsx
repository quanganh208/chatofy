import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@react-native-vector-icons/ionicons/static';

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
  return (
    <Tabs>
      <Tabs.Screen
        name="conversation"
        options={{ title: 'Conversation', tabBarIcon: tabIcon('chatbubbles-outline') }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'History', tabBarIcon: tabIcon('time-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: tabIcon('settings-outline') }}
      />
      {/* The conference stack sends a signed-out user to sign in. */}
      <Tabs.Screen
        name="conference"
        options={{ title: 'Conference', tabBarIcon: tabIcon('videocam-outline') }}
      />
    </Tabs>
  );
}

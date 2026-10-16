import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Build a tabBarIcon render fn so each tab shows a real glyph, not a missing-glyph box. */
function tabIcon(name: IoniconName) {
  const Icon = ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} color={color} size={size} />
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
      <Tabs.Screen
        name="conference"
        options={{ title: 'Conference', tabBarIcon: tabIcon('videocam-outline') }}
      />
      <Tabs.Screen
        name="conference-poc"
        options={{ title: 'Conference PoC', tabBarIcon: tabIcon('flask-outline') }}
      />
    </Tabs>
  );
}

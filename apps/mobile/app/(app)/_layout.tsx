import { Tabs } from 'expo-router';

export default function AppLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="conversation" options={{ title: 'Conversation' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      <Tabs.Screen name="conference" options={{ title: 'Conference' }} />
      <Tabs.Screen name="conference-poc" options={{ title: 'Conference PoC' }} />
    </Tabs>
  );
}

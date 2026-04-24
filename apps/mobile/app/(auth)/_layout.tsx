import { Stack } from 'expo-router';

// Auth group layout — no header chrome on auth screens
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

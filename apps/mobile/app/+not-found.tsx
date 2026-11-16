import { Link, Stack } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found' }} />
      <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
        <View className="flex-1 items-center justify-center bg-background">
          <Text variant="h3">This screen does not exist.</Text>
          <View className="mt-4">
            <Link href="/">
              {/* Ink with an underline, not a blue: colour alone marks nothing here. */}
              <Text className="text-md text-accent-text underline">Go to home screen</Text>
            </Link>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}

import { ActivityIndicator, View } from 'react-native';
import { Redirect, type Href } from 'expo-router';
import { entryRedirect } from '@/auth/route-guard';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/** A cold start lands on the app for a stored session, on sign-in without one. */
export default function EntryScreen() {
  const { session, isLoading } = useAuth();
  const { colors } = useTheme();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }
  return <Redirect href={entryRedirect(session !== null) as Href} />;
}

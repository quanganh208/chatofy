import { SafeAreaView, StyleSheet, Text } from 'react-native';

// Sign-in screen stub — UI and auth logic added in feature phase
export default function SignInScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Sign in (stub)</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  label: {
    fontSize: 16,
    color: '#888',
  },
});

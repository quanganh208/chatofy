import { Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SignUpScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Sign up (stub)</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  label: {
    fontSize: 18,
    color: '#6E6E73',
  },
});

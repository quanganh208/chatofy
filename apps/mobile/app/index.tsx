import { SafeAreaView, Text, StyleSheet } from 'react-native';

export default function LandingScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Chatofy</Text>
      <Text style={styles.subtitle}>coming soon</Text>
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
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#000000',
  },
  subtitle: {
    fontSize: 16,
    color: '#6E6E73',
    marginTop: 8,
  },
});

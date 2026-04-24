import { SafeAreaView, StyleSheet, Text } from 'react-native';

// Settings screen stub — preferences UI added in feature phase
export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Settings (stub)</Text>
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

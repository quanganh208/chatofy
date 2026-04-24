import { SafeAreaView, StyleSheet, Text } from 'react-native';

// History screen stub — transcript list added in feature phase
export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>History (stub)</Text>
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

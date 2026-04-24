import { SafeAreaView, StyleSheet, Text } from 'react-native';

// Conversation / translation screen stub — voice UI added in feature phase
export default function ConversationScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Conversation screen (stub)</Text>
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

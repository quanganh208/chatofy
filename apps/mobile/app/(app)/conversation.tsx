import { SafeAreaView, Text, StyleSheet } from 'react-native';

export default function ConversationScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Conversation (stub)</Text>
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

import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { RTCView, MediaStream } from 'react-native-webrtc';

interface ConferencePocCallViewProps {
  roomId: string;
  localStream: MediaStream;
  remoteStreams: MediaStream[];
  onLeave: () => void;
}

export function ConferencePocCallView({
  roomId,
  localStream,
  remoteStreams,
  onLeave,
}: ConferencePocCallViewProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.statusBar}>
        Room: {roomId} · {remoteStreams.length + 1} participant
        {remoteStreams.length !== 0 ? 's' : ''}
      </Text>

      <Text style={styles.label}>You</Text>
      <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" mirror />

      {remoteStreams.map((stream) => (
        <RTCView
          key={stream.id}
          streamURL={stream.toURL()}
          style={styles.remoteVideo}
          objectFit="cover"
        />
      ))}

      <TouchableOpacity style={styles.leaveButton} onPress={onLeave} activeOpacity={0.7}>
        <Text style={styles.leaveButtonText}>Leave call</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0C0A09',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
  },
  statusBar: {
    color: '#A8A29E',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  label: {
    color: '#78716C',
    fontSize: 12,
    marginBottom: 6,
  },
  localVideo: {
    width: '100%',
    height: 240,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#1C1917',
  },
  remoteVideo: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    marginBottom: 12,
    backgroundColor: '#1C1917',
  },
  leaveButton: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  leaveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

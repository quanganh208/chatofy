// Scaffold for the realtime conversation feature (roadmap): no consumers yet.
// Interface for audio players — concrete adapters (expo-av, react-native-audio-api) added later
export interface AudioPlayer {
  enqueue(chunk: Uint8Array): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  readonly isPlaying: boolean;
}

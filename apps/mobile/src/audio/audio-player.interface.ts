// Interface for audio players — concrete adapters (expo-av, react-native-audio-api) added later
export interface IAudioPlayer {
  enqueue(chunk: Uint8Array): void;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  readonly isPlaying: boolean;
}

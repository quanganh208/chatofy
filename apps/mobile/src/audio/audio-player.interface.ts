// IAudioPlayer — contract for streaming PCM audio playback.
// Concrete adapters (expo-av, react-native-audio-api) go in this directory.
export interface IAudioPlayer {
  /** Push a PCM chunk into the playback buffer. */
  enqueue(chunk: Uint8Array): void;
  /** Begin playback of buffered audio. */
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  readonly isPlaying: boolean;
}

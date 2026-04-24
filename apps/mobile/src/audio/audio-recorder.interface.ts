// Called on each recorded audio frame with raw PCM chunk and sequence number
export type AudioFrameCallback = (chunk: Uint8Array, sequence: number) => void;

// Interface for audio recorders — concrete adapters (expo-av, react-native-audio-api) added later
export interface IAudioRecorder {
  start(onFrame: AudioFrameCallback): Promise<void>;
  stop(): Promise<void>;
  readonly isRecording: boolean;
}

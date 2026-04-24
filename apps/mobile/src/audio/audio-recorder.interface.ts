// IAudioRecorder — contract for capturing microphone audio as PCM frames.
// Concrete adapters (expo-av, react-native-audio-api) go in this directory.
export type AudioFrameCallback = (chunk: Uint8Array, sequence: number) => void;

export interface IAudioRecorder {
  /** Begin recording; fires onFrame for each captured PCM chunk. */
  start(onFrame: AudioFrameCallback): Promise<void>;
  /** Stop recording and release mic resources. */
  stop(): Promise<void>;
  readonly isRecording: boolean;
}

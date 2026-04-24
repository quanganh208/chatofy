// SttProvider contract — streaming speech-to-text (e.g. Whisper, Deepgram)
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface SttProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

export interface SttTranscriptEvent {
  text: string;
  isFinal: boolean;
  language: LanguageCode;
}

export interface SttProvider {
  readonly name: string;
  startStream(
    language: LanguageCode,
    audioFormat: AudioFormat,
    onTranscript: (event: SttTranscriptEvent) => void,
  ): Promise<StreamHandle>;
  pushAudio(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}

// RealtimeProvider contract — speech-to-speech streaming (e.g. OpenAI Realtime API)
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface RealtimeProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
  voice?: string;
}

export interface RealtimeStartParams {
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  audioFormat: AudioFormat;
}

export interface RealtimeStreamEvents {
  onPartialTranscript?(text: string, lang: LanguageCode): void;
  onFinalTranscript?(text: string, lang: LanguageCode): void;
  onTranslatedAudio?(chunk: Uint8Array): void;
  onError?(err: Error): void;
  onClose?(): void;
}

/** Provider that handles simultaneous STT + translation + TTS in a single stream. */
export interface RealtimeProvider {
  readonly name: string;
  start(params: RealtimeStartParams, events: RealtimeStreamEvents): Promise<StreamHandle>;
  pushAudio(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}

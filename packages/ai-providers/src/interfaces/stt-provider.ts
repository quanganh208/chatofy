// SttProvider contract — speech-to-text. Batch transcription is the required
// core (turn-based flow); streaming is an optional future path. Mirrors the
// TtsProvider shape (required batch method + optional stream method).
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface SttProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

/** Result of transcribing a complete utterance. */
export interface SttTranscriptResult {
  text: string;
  language: LanguageCode;
}

/** Streaming partial/final transcript event (future realtime path). */
export interface SttTranscriptEvent {
  text: string;
  isFinal: boolean;
  language: LanguageCode;
}

export interface SttProvider {
  readonly name: string;
  /** Batch transcription of a complete utterance — the turn-based core. */
  transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
  ): Promise<SttTranscriptResult>;
  /** Optional streaming variant — partials delivered via callback. */
  startStream?(
    language: LanguageCode,
    audioFormat: AudioFormat,
    onTranscript: (event: SttTranscriptEvent) => void,
  ): Promise<StreamHandle>;
  pushAudio?(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}

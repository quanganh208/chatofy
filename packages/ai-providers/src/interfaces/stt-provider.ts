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

/** Per-utterance knobs a backend may honour, or ignore when it cannot. */
export interface SttTranscribeOptions {
  /**
   * Terms the recognizer is likely to get wrong, to bias decoding towards.
   *
   * The same list `TranslationHints.hotwords` carries to the translator, which
   * is deliberate rather than convenient: the field's whole premise is that the
   * recognizer mishears these words, so the recognizer is the first place it
   * should be spent. Passing it on to the translator as well covers the term the
   * biasing still misses.
   *
   * Optional for the backend, not for the caller: a provider that cannot bias
   * its decoder ignores this rather than failing, so a call site must not read a
   * silent pass-through as the terms having been applied.
   */
  hotwords?: string[];
}

export interface SttProvider {
  readonly name: string;
  /** Batch transcription of a complete utterance — the turn-based core. */
  transcribe(
    audio: Uint8Array,
    mimeType: string,
    language: LanguageCode,
    options?: SttTranscribeOptions,
  ): Promise<SttTranscriptResult>;
  /** Optional streaming variant — partials delivered via callback. */
  startStream?(
    language: LanguageCode,
    audioFormat: AudioFormat,
    onTranscript: (event: SttTranscriptEvent) => void,
  ): Promise<StreamHandle>;
  pushAudio?(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}

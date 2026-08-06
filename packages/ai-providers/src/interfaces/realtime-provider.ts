// RealtimeProvider contract — one backend does speech-to-speech in a single
// stream, instead of the STT → translate → TTS trio the rest of this package
// describes.
import type { AudioFormat, LanguageCode, ProviderConfig, StreamHandle } from './provider-types.js';

export interface RealtimeProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
  voice?: string;
}

export interface RealtimeStartParams {
  /**
   * The language the speaker is expected to use.
   *
   * ADVISORY, not a setting. A speech-to-speech backend may detect the source
   * itself and take only a target — the Gemini Live backend does exactly that.
   * It is still worth passing: a backend that detects can compare what it heard
   * against what was expected and report the disagreement, which is the only
   * way a caller learns that auto-detection is failing on its audio.
   */
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  audioFormat: AudioFormat;
  /**
   * Use this key for this session instead of the configured one.
   *
   * Exists because a live session connects once and holds, so a provider cannot
   * spread load across a key pool the way a per-request provider does — the
   * choice has to be made by whoever opens the session. A measurement harness
   * that runs one session per utterance uses this to walk a pool; ordinary
   * callers leave it unset.
   */
  apiKey?: string;
}

/**
 * What a live session reports as it runs.
 *
 * Two independent transcript streams rather than one with a partial/final flag.
 * That is not a preference: a speech-to-speech backend hears one language and
 * speaks another, so "the transcript" is two different texts, and neither
 * arrives with a finality marker — both grow by deltas until the session ends.
 * A single channel could not say which language a given delta belonged to
 * without the caller re-deriving it from the direction.
 */
export interface RealtimeStreamEvents {
  /**
   * Incremental text of what the backend heard, tagged with the language it
   * actually detected — which is what makes a mismatch against
   * {@link RealtimeStartParams.sourceLanguage} observable.
   */
  onSourceTranscript?(delta: string, lang: LanguageCode): void;
  /** Incremental text of what the backend spoke. Always the target language. */
  onTargetTranscript?(delta: string): void;
  /**
   * Translated audio, raw and headerless.
   *
   * The rate travels with the chunk because it is the backend's, not the
   * caller's: input at one rate does not imply output at the same one. Gemini
   * Live takes 16 kHz and answers at 24 kHz.
   */
  onTranslatedAudio?(chunk: Uint8Array, sampleRate: number): void;
  onError?(err: Error): void;
  onClose?(reason?: string): void;
}

/** Provider that handles simultaneous STT + translation + TTS in a single stream. */
export interface RealtimeProvider {
  readonly name: string;
  start(params: RealtimeStartParams, events: RealtimeStreamEvents): Promise<StreamHandle>;
  pushAudio(handle: StreamHandle, chunk: Uint8Array): Promise<void>;
}

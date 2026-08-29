// Root barrel — re-exports all public contracts, errors, registry utilities, and
// the concrete ElevenLabs/Gemini/local-sidecar provider implementations. Each
// provider owns its own model defaults, so no model selection layer sits above
// them.

export type {
  LanguageCode,
  AudioFormat,
  StreamHandle,
  ProviderConfig,
  RealtimeProviderConfig,
  RealtimeStartParams,
  RealtimeStreamEvents,
  RealtimeProvider,
  SpeakerEmbeddingProvider,
  SpeakerEmbeddingResult,
  SttProviderConfig,
  SttTranscriptResult,
  SttTranscriptEvent,
  SttProvider,
  TranslationProviderConfig,
  TranslationRequest,
  TranslationResult,
  TranslationProvider,
  TranslationHints,
  TranslationStyle,
  TtsProviderConfig,
  TtsSynthesizeRequest,
  TtsProvider,
  TtsVoice,
} from './interfaces/index.js';

export {
  ProviderError,
  ProviderNotImplementedError,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from './errors/index.js';

// Transcript canonicalization, and the match-fold shared with the error
// taxonomy in `benchmarks/error-analysis`.
export { normalizeTranscript, foldForMatch } from './text/vietnamese.js';

// Spoken numbers -> digits, deterministically and in process, so a finished line
// carries its digits the first time it paints. Pure and total on a string: no
// network, no key, no second event.
export { inverseNormalizeTranscript } from './text/inverse-normalize-transcript.js';

export { ProviderRegistry } from './registry/index.js';
export type { ProviderKind, ProviderKindMap, ProviderEntry } from './registry/index.js';

// Concrete provider implementations.
export { ElevenLabsSttProvider } from './providers/elevenlabs/elevenlabs-stt-provider.js';
export type { ElevenLabsSttConfig } from './providers/elevenlabs/elevenlabs-stt-provider.js';
export { ElevenLabsTtsProvider } from './providers/elevenlabs/elevenlabs-tts-provider.js';
export type { ElevenLabsTtsConfig } from './providers/elevenlabs/elevenlabs-tts-provider.js';
export { GeminiTranslationProvider } from './providers/gemini/gemini-translation-provider.js';
export type { GeminiTranslationConfig } from './providers/gemini/gemini-translation-provider.js';
export {
  GeminiLiveTranslateProvider,
  INPUT_SAMPLE_RATE as GEMINI_LIVE_INPUT_SAMPLE_RATE,
} from './providers/gemini-live/gemini-live-translate-provider.js';
export type { GeminiLiveTranslateConfig } from './providers/gemini-live/gemini-live-translate-provider.js';
export { LocalSpeechEmbeddingProvider } from './providers/local-speech/local-speech-embedding-provider.js';
export type { LocalSpeechEmbeddingConfig } from './providers/local-speech/local-speech-embedding-provider.js';
export { LocalSpeechSttProvider } from './providers/local-speech/local-speech-stt-provider.js';
export type { LocalSpeechSttConfig } from './providers/local-speech/local-speech-stt-provider.js';
export { LocalSpeechTtsProvider } from './providers/local-speech/local-speech-tts-provider.js';
export type { LocalSpeechTtsConfig } from './providers/local-speech/local-speech-tts-provider.js';

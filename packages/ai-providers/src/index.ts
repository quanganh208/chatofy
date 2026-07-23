// Root barrel — re-exports all public contracts, errors, registry utilities, and
// the concrete ElevenLabs/Gemini provider implementations + quality resolver.

export type {
  LanguageCode,
  AudioFormat,
  StreamHandle,
  ProviderConfig,
  RealtimeProviderConfig,
  RealtimeStartParams,
  RealtimeStreamEvents,
  RealtimeProvider,
  SttProviderConfig,
  SttTranscriptResult,
  SttTranscriptEvent,
  SttProvider,
  TranslationProviderConfig,
  TranslationRequest,
  TranslationResult,
  TranslationProvider,
  TtsProviderConfig,
  TtsSynthesizeRequest,
  TtsProvider,
} from './interfaces/index.js';

export {
  ProviderError,
  ProviderNotImplementedError,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from './errors/index.js';

export { ProviderRegistry, readAiProviderEnv } from './registry/index.js';
export type {
  ProviderKind,
  ProviderKindMap,
  ProviderEntry,
  AiProviderEnv,
} from './registry/index.js';

// Quality profile resolver (continuous speed↔quality dial → model tiers).
export { resolveQualityProfile } from './profiles/quality-profile.js';
export type { QualityProfile, QualityProfileOverrides } from './profiles/quality-profile.js';

// Concrete provider implementations.
export { ElevenLabsSttProvider } from './providers/elevenlabs/elevenlabs-stt-provider.js';
export type { ElevenLabsSttConfig } from './providers/elevenlabs/elevenlabs-stt-provider.js';
export { ElevenLabsTtsProvider } from './providers/elevenlabs/elevenlabs-tts-provider.js';
export type { ElevenLabsTtsConfig } from './providers/elevenlabs/elevenlabs-tts-provider.js';
export { GeminiTranslationProvider } from './providers/gemini/gemini-translation-provider.js';
export type { GeminiTranslationConfig } from './providers/gemini/gemini-translation-provider.js';
export { LocalSpeechSttProvider } from './providers/local-speech/local-speech-stt-provider.js';
export type { LocalSpeechSttConfig } from './providers/local-speech/local-speech-stt-provider.js';
export { LocalSpeechTtsProvider } from './providers/local-speech/local-speech-tts-provider.js';
export type { LocalSpeechTtsConfig } from './providers/local-speech/local-speech-tts-provider.js';

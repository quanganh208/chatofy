// Root barrel — re-exports all public contracts, errors, and registry utilities.
// No concrete provider implementations are exported from this package.

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
  ProviderNotImplementedError,
  ProviderConfigError,
  ProviderConnectionError,
} from './errors/index.js';

export { ProviderRegistry, readAiProviderEnv } from './registry/index.js';
export type { ProviderKind, ProviderEntry, AiProviderEnv } from './registry/index.js';

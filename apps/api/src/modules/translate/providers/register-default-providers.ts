// Composition-root registration of the concrete AI providers.
// Adding a backend = one register() call here; the factory and pipeline stay
// untouched (they resolve by name through the registry abstraction).
import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  GeminiTranslationProvider,
  LocalSpeechSttProvider,
  LocalSpeechTtsProvider,
  ProviderRegistry,
  type ProviderConfig,
} from '@chatofy/ai-providers';

/**
 * Superset config bag passed on every registry resolve. Each entry picks the
 * fields it needs; unset fields surface as ProviderConfigError inside the
 * provider constructor (lazy key enforcement, same as before the registry).
 *
 * Models are absent by design: each provider owns its own model default, so
 * there is nothing above them to keep in sync.
 */
export interface AiProviderResolveConfig extends ProviderConfig {
  elevenLabsApiKey?: string;
  geminiApiKey?: string;
  elevenLabsTtsVoiceId?: string;
  localSttUrl?: string;
  localTtsUrl?: string;
}

export function registerDefaultProviders(
  registry: ProviderRegistry,
): ProviderRegistry {
  registry.register('stt', {
    name: 'elevenlabs',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new ElevenLabsSttProvider({ apiKey: c.elevenLabsApiKey });
    },
  });

  // Local sherpa-onnx sidecar: one backend serving both vi and en — it picks
  // the engine from the language passed to transcribe().
  registry.register('stt', {
    name: 'local',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new LocalSpeechSttProvider({ baseUrl: c.localSttUrl });
    },
  });

  registry.register('translation', {
    name: 'gemini',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new GeminiTranslationProvider({ apiKey: c.geminiApiKey });
    },
  });

  registry.register('tts', {
    name: 'elevenlabs',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new ElevenLabsTtsProvider({
        apiKey: c.elevenLabsApiKey,
        voice: c.elevenLabsTtsVoiceId,
      });
    },
  });

  // One local backend covers both output languages; the sidecar picks the
  // engine from the language and owns each one's default voice.
  registry.register('tts', {
    name: 'local',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new LocalSpeechTtsProvider({ baseUrl: c.localTtsUrl });
    },
  });

  return registry;
}

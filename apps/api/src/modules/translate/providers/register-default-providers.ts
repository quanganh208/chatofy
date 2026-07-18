// Composition-root registration of the concrete AI providers.
// Adding a backend = one register() call here; the factory and pipeline stay
// untouched (they resolve by name through the registry abstraction).
import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  GeminiTranslationProvider,
  ProviderRegistry,
  VieNeuTtsProvider,
  type ProviderConfig,
} from '@chatofy/ai-providers';

/**
 * Superset config bag passed on every registry resolve. Each entry picks the
 * fields it needs; unset fields surface as ProviderConfigError inside the
 * provider constructor (lazy key enforcement, same as before the registry).
 */
export interface AiProviderResolveConfig extends ProviderConfig {
  elevenLabsApiKey?: string;
  geminiApiKey?: string;
  elevenLabsTtsVoiceId?: string;
  vieNeuTtsUrl?: string;
  vieNeuTtsVoice?: string;
  sttModel?: string;
  translationModel?: string;
  ttsModel?: string;
  thinkingBudget?: number;
}

export function registerDefaultProviders(
  registry: ProviderRegistry,
): ProviderRegistry {
  registry.register('stt', {
    name: 'elevenlabs',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new ElevenLabsSttProvider({
        apiKey: c.elevenLabsApiKey,
        model: c.sttModel,
      });
    },
  });

  registry.register('translation', {
    name: 'gemini',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new GeminiTranslationProvider({
        apiKey: c.geminiApiKey,
        model: c.translationModel,
        thinkingBudget: c.thinkingBudget,
      });
    },
  });

  registry.register('tts', {
    name: 'elevenlabs',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new ElevenLabsTtsProvider({
        apiKey: c.elevenLabsApiKey,
        voice: c.elevenLabsTtsVoiceId,
        model: c.ttsModel,
      });
    },
  });

  registry.register('tts', {
    name: 'vieneu',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new VieNeuTtsProvider({
        baseUrl: c.vieNeuTtsUrl,
        voice: c.vieNeuTtsVoice,
      });
    },
  });

  return registry;
}

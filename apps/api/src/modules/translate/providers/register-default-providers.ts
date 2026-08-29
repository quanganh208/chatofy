// Composition-root registration of the concrete AI providers.
// Adding a backend = one register() call here; the factory and pipeline stay
// untouched (they resolve by name through the registry abstraction).
import { Logger } from '@nestjs/common';
import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  GeminiLiveTranslateProvider,
  GeminiTranslationProvider,
  LocalSpeechEmbeddingProvider,
  LocalSpeechSttProvider,
  LocalSpeechTtsProvider,
  ProviderRegistry,
  type ProviderConfig,
} from '@chatofy/ai-providers';

/**
 * Where absorbed rate limits are reported.
 *
 * Module-scoped rather than per-provider: the registry builds providers from a
 * plain factory with no injector in reach, and one name for this signal is what
 * makes it greppable in a log.
 */
const quotaLogger = new Logger('GeminiQuota');

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
  /** One Gemini key, or several comma-separated to rotate across. */
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

  // Voice vectors for per-turn speaker attribution, from the same sidecar over
  // its own endpoint. One name only, like `realtime` below: nothing selects it
  // from the environment, so registering a second would be the moment to decide
  // how a caller should choose.
  registry.register('speakerEmbedding', {
    name: 'local',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new LocalSpeechEmbeddingProvider({ baseUrl: c.localSttUrl });
    },
  });

  // Speech-to-speech in one stream, as the comparison baseline against the
  // STT → translate → TTS trio below. The ONLY realtime entry, and the live
  // session path resolves it with `resolveOnly` — so this name is a registry
  // key and nothing else: no environment variable selects it, and no other
  // module repeats it. Registering a second one turns that resolve into a loud
  // error, which is the right moment to decide how a caller should choose.
  registry.register('realtime', {
    name: 'gemini-live',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new GeminiLiveTranslateProvider({ apiKey: c.geminiApiKey });
    },
  });

  registry.register('translation', {
    name: 'gemini',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new GeminiTranslationProvider({
        apiKey: c.geminiApiKey,
        // The earliest sign that request volume has outgrown the quota, and it
        // used to be entirely silent: the pair went on cooldown and the walk
        // carried on, so the first visible symptom was a slow or failed turn
        // well after the cause. Continuous capture raises turns per minute, so
        // this is the signal that says whether it has gone too far. There is no
        // second signal to watch for instead: every ladder is flash now, so
        // exhaustion surfaces as a failed request rather than as a slow one.
        onQuotaCooldown: ({ model, cooldownMs }) =>
          quotaLogger.warn(
            `rate limited on ${model}; cooling for ${cooldownMs}ms`,
          ),
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

// Composition-root registration of the concrete AI providers.
// Adding a backend = one register() call here; the factory and pipeline stay
// untouched (they resolve by name through the registry abstraction).
import { Logger } from '@nestjs/common';
import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  GeminiLiveTranslateProvider,
  GeminiSummarizationProvider,
  GeminiTranslationProvider,
  LocalSpeechEmbeddingProvider,
  OpenAiCompatibleTranslationProvider,
  LocalSpeechSttProvider,
  LocalSpeechTtsProvider,
  ProviderRegistry,
  type ProviderConfig,
} from '@chatofy/ai-providers';
import { recordQuotaCooldown } from '../quota-cooldown-meter';

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
  /**
   * The credential for whichever OpenAI-compatible host was selected.
   *
   * One field for the family, not one per host: only one translation provider
   * is ever resolved, so per-host fields would be a column of blanks that grows
   * every time the host table does. Which host it belongs to is decided by
   * `AI_TRANSLATION_PROVIDER`, the same thing that decides which entry is built.
   *
   * A key is the ONLY thing about a host that comes from the environment. The
   * endpoint and the model do not, and that is not squeamishness about knobs —
   * a model id is only meaningful against the endpoint that serves it, so
   * splitting them across two places lets a deployment express a pair that
   * cannot work. It did: an override naming an OpenAI model while DeepSeek was
   * selected sent a `gpt-5-nano` request to `api.deepseek.com`, which answers
   * 400 on every turn.
   */
  openAiCompatibleApiKey?: string;
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
        onQuotaCooldown: ({ model, cooldownMs }) => {
          recordQuotaCooldown(model);
          quotaLogger.warn(
            `rate limited on ${model}; cooling for ${cooldownMs}ms`,
          );
        },
      });
    },
  });

  // Every host that speaks the OpenAI chat-completions format, and the three
  // things each one needs that the others do not.
  //
  // A table rather than a registration apiece, because the differences between
  // these hosts are data and the similarities are all of the code. What is in
  // here is deliberately NOT configuration: a base URL identifies a host, a
  // reasoning flag turns off a pass the host enables by default, and a ceiling
  // field name is a host's refusal to accept the other one. Get any of the three
  // wrong and the translator still works — it is just slower than the recorded
  // numbers, or fails every turn — with nothing in the environment to say why.
  // So they are written down once, here, where a reviewer sees them, instead of
  // being asked of whoever writes the .env.
  //
  // Adding a row costs nothing in the environment: the key is one field for the
  // whole family, so a new host is four lines here and a different value for
  // AI_TRANSLATION_PROVIDER. Running one host on a SECOND model is a row too —
  // `deepseek` and a `deepseek-pro` beside it — rather than a variable, because
  // a row is a pair that has been checked and a variable is a pair that has
  // not. Comparing two models WITHOUT shipping either needs no row: pass
  // `--model` to `benchmarks/error-analysis/translate-rows.mjs`.
  //
  // A host that is NOT in this table is reached from
  // `benchmarks/error-analysis/translate-rows.mjs`, which takes all three as
  // command-line flags. That split is the point: trying a host is an experiment
  // and needs no code, shipping one is a decision and gets reviewed.
  const openAiCompatibleHosts = [
    {
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      // Thinking is ON by default on this host at effort `high`. Left on, a live
      // turn waits for a reasoning pass it has no use for — measured at 0.92s
      // against 0.85s with it off, and that gap widens with input.
      extraBody: { thinking: { type: 'disabled' } },
    },
    {
      name: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-nano',
      // The same default-on reasoning trap under another name. `minimal` is the
      // lowest this line accepts; there is no way to switch it off outright.
      extraBody: { reasoning_effort: 'minimal' },
      // This line REJECTS `max_tokens` rather than ignoring it — 400
      // "Unsupported parameter" on every request — so the name is chosen, never
      // merely added.
      maxOutputTokensField: 'max_completion_tokens' as const,
    },
  ];

  for (const host of openAiCompatibleHosts) {
    registry.register('translation', {
      name: host.name,
      create: (cfg: ProviderConfig) => {
        const c = cfg as AiProviderResolveConfig;
        return new OpenAiCompatibleTranslationProvider({
          apiKey: c.openAiCompatibleApiKey,
          // Endpoint and model together, from the same row. Nothing outside
          // this file can pair one host's endpoint with another host's model.
          baseUrl: host.baseUrl,
          models: [host.model],
          name: host.name,
          extraBody: host.extraBody,
          maxOutputTokensField: host.maxOutputTokensField,
          // No `onQuotaCooldown` on any of these: the signal it carries is a
          // free tier running out, and none of these hosts has such a wall.
        });
      },
    });
  }

  // Minutes over a FINISHED conversation, not a live turn. One name only, like
  // `realtime` and `speakerEmbedding` above: no environment variable selects it,
  // so the minutes module resolves it with `resolveOnly` and a second
  // registration would be the loud moment to decide how a caller should choose.
  registry.register('summarization', {
    name: 'gemini',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new GeminiSummarizationProvider({
        apiKey: c.geminiApiKey,
        onQuotaCooldown: ({ model, cooldownMs }) => {
          recordQuotaCooldown(model);
          quotaLogger.warn(
            `rate limited on ${model}; cooling for ${cooldownMs}ms`,
          );
        },
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

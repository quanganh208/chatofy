// Composition-root registration of the concrete AI providers.
// Adding a backend = one register() call here; the factory and pipeline stay
// untouched (they resolve by name through the registry abstraction).
import { Logger } from '@nestjs/common';
import {
  FailoverLoanwordRespeller,
  FailoverSummarizationProvider,
  FailoverTranslationProvider,
  HostCircuit,
  isUsageLimitError,
  OpenAiCompatibleTranslationPolisher,
  tripOnPersistentFailure,
  type SummarizationProvider,
  type TranslationPolisher,
  GeminiLiveTranslateProvider,
  GeminiSummarizationProvider,
  GeminiTranslationProvider,
  LocalSpeechDisplayRestorer,
  LocalSpeechEmbeddingProvider,
  OpenAiCompatibleLoanwordRespeller,
  OpenAiCompatibleSummarizationProvider,
  OpenAiCompatibleTranslationProvider,
  LocalSpeechSttProvider,
  LocalSpeechTtsProvider,
  ProviderRegistry,
  type ProviderConfig,
} from '@chatofy/ai-providers';
import { recordQuotaCooldown } from '../quota-cooldown-meter';
import { logLlmCall } from './llm-call-log';

/**
 * Where absorbed rate limits are reported.
 *
 * Module-scoped rather than per-provider: the registry builds providers from a
 * plain factory with no injector in reach, and one name for this signal is what
 * makes it greppable in a log.
 */
const quotaLogger = new Logger('GeminiQuota');

/** Where the Command Code circuit says it opened or closed. */
const circuitLogger = new Logger('CommandCodeCircuit');

/** Command Code's OpenAI-compatible endpoint; one URL serves every plan tier. */
const COMMAND_CODE_BASE_URL = 'https://api.commandcode.ai/provider/v1';

/**
 * The model that polishes on DeepSeek direct while Command Code is out.
 *
 * Judged over the 162 prod turns with earlier turns as context (2026-11-03,
 * `benchmarks/translation-judge` review arms): vi→en turns with a serious
 * translation error went 23.7% → 1.3% (18 fixed, 1 broken) on this model,
 * against 6.6% (15 fixed, 2 broken) on `deepseek-flash`. It costs about $0.001
 * a turn against flash's $0.0001, and the polish is off the listener's path,
 * so its ~1.3 s is not waited on.
 */
const DEEPSEEK_POLISH_MODEL = 'deepseek-v4-pro';

/**
 * Superset config bag passed on every registry resolve. Each entry picks the
 * fields it needs; unset fields surface as ProviderConfigError inside the
 * provider constructor (lazy key enforcement, same as before the registry).
 *
 * Models are absent by design: each provider owns its own model default, so
 * there is nothing above them to keep in sync.
 */
export interface AiProviderResolveConfig extends ProviderConfig {
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
  /** Command Code's key; the `commandcode` selection's fallback reads the one above. */
  commandCodeApiKey?: string;
  localSttUrl?: string;
  localTtsUrl?: string;
}

export function registerDefaultProviders(
  registry: ProviderRegistry,
): ProviderRegistry {
  // Local sherpa-onnx sidecar: the only recognizer, serving every language — it
  // picks the engine from the language passed to transcribe(). One name only,
  // resolved with `resolveOnly`: speech is always self-hosted, so nothing in
  // the environment selects a recognizer.
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

  // Punctuation and case for the Vietnamese display, from the same sidecar.
  // One name only, for the reason `speakerEmbedding` gives above.
  registry.register('displayRestorer', {
    name: 'local',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new LocalSpeechDisplayRestorer({ baseUrl: c.localSttUrl });
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
          onCall: logLlmCall,
          // DeepSeek accepts `stream_options.include_usage` (probed on
          // 2026-11-02); the OpenAI row stays off until a probe says it does.
          reportStreamUsage: host.name === 'deepseek',
          // No `onQuotaCooldown` on any of these: the signal it carries is a
          // free tier running out, and none of these hosts has such a wall.
        });
      },
    });
    // The loanword respeller rides the same row under the same name, so it is
    // resolved by the translation's own provider name: the endpoint, model and
    // request fields that answer the translation answer the respelling, and a
    // host without a row here simply has no respeller.
    registry.register('loanwordRespeller', {
      name: host.name,
      create: (cfg: ProviderConfig) => {
        const c = cfg as AiProviderResolveConfig;
        return new OpenAiCompatibleLoanwordRespeller({
          apiKey: c.openAiCompatibleApiKey,
          baseUrl: host.baseUrl,
          model: host.model,
          name: host.name,
          extraBody: host.extraBody,
          maxOutputTokensField: host.maxOutputTokensField,
          onCall: logLlmCall,
        });
      },
    });
  }

  // `commandcode`: every translate-path call on Command Code, with the DeepSeek
  // row above as the fallback.
  //
  // Measured on 2026-10-28 (plans/reports/benchmark-261028-1636-command-code-models.md):
  // `deepseek/deepseek-v4-flash-fast` there matched DeepSeek direct on COMET
  // (−0.0015, within noise) with a first token at 0.41 s against 0.61 s, so it
  // carries the live path; `gpt-5.6-sol` scored +0.0066 at ~1.5 s, too slow for
  // a line someone is waiting on, so it only edits a line already delivered.
  // The fast model takes no `reasoning_effort` — it has no reasoning to turn
  // off, and the host answers 400 to the flag.
  //
  // ONE circuit for all three, made here rather than per provider, because the
  // failure it tracks is the plan's usage window, which is account-wide: once
  // the translator has seen it, the respeller and the polisher would only pay
  // a failed round-trip each to learn the same thing.
  const commandCodeCircuit = new HostCircuit({
    onTransition: (state, reason) =>
      circuitLogger.warn(`command code circuit ${state}: ${reason}`),
  });
  const deepseek = openAiCompatibleHosts.find(
    (host) => host.name === 'deepseek',
  )!;

  registry.register('translation', {
    name: 'commandcode',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new FailoverTranslationProvider({
        name: 'commandcode',
        circuit: commandCodeCircuit,
        primary: new OpenAiCompatibleTranslationProvider({
          apiKey: c.commandCodeApiKey,
          baseUrl: COMMAND_CODE_BASE_URL,
          models: ['deepseek/deepseek-v4-flash-fast'],
          name: 'commandcode',
          onCall: logLlmCall,
          // The proxy answers `stream_options.include_usage` with token counts
          // and cache hits (probed on 2026-11-02).
          reportStreamUsage: true,
        }),
        secondary: new OpenAiCompatibleTranslationProvider({
          apiKey: c.openAiCompatibleApiKey,
          baseUrl: deepseek.baseUrl,
          models: [deepseek.model],
          name: deepseek.name,
          extraBody: deepseek.extraBody,
          onCall: logLlmCall,
          reportStreamUsage: true,
        }),
      });
    },
  });
  registry.register('loanwordRespeller', {
    name: 'commandcode',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new FailoverLoanwordRespeller({
        name: 'commandcode',
        circuit: commandCodeCircuit,
        primary: new OpenAiCompatibleLoanwordRespeller({
          apiKey: c.commandCodeApiKey,
          baseUrl: COMMAND_CODE_BASE_URL,
          model: 'deepseek/deepseek-v4-flash-fast',
          name: 'commandcode',
          onCall: logLlmCall,
        }),
        secondary: new OpenAiCompatibleLoanwordRespeller({
          apiKey: c.openAiCompatibleApiKey,
          baseUrl: deepseek.baseUrl,
          model: deepseek.model,
          name: deepseek.name,
          extraBody: deepseek.extraBody,
          onCall: logLlmCall,
        }),
      });
    },
  });
  // While Command Code is out the polish moves to DeepSeek direct, on the same
  // key the translation falls back to. A second pass by the drafting host still
  // pays: run over the 162 judged prod turns with earlier turns as context,
  // `deepseek-v4-pro` cut vi→en turns with a serious translation error from
  // 23.7% to 1.3% (`benchmarks/translation-judge`, review arms), and the pass
  // restores a closing sentence the translator drops ("…two. Understand and
  // respond.") 28 times in 30 on either DeepSeek model.
  registry.register('translationPolisher', {
    name: 'commandcode',
    create: (cfg: ProviderConfig): TranslationPolisher => {
      const c = cfg as AiProviderResolveConfig;
      const polisher = new OpenAiCompatibleTranslationPolisher({
        apiKey: c.commandCodeApiKey,
        baseUrl: COMMAND_CODE_BASE_URL,
        model: 'gpt-5.6-sol',
        name: 'commandcode-polish',
        onCall: logLlmCall,
      });
      // Without a DeepSeek key there is nowhere to move to, and the draft
      // stands while Command Code is out, as it always did.
      const fallback = c.openAiCompatibleApiKey
        ? new OpenAiCompatibleTranslationPolisher({
            apiKey: c.openAiCompatibleApiKey,
            baseUrl: deepseek.baseUrl,
            model: DEEPSEEK_POLISH_MODEL,
            name: 'deepseek-polish',
            extraBody: deepseek.extraBody,
            onCall: logLlmCall,
          })
        : null;
      // A spent usage window is the plan's, so it trips the shared circuit. A
      // rejection, though, is this MODEL's: a plan without `gpt-5.6-sol` would
      // answer 403 here while the fast model still serves translation, so it
      // only moves the polish, on a circuit of its own. Either way a failed
      // call is rethrown rather than retried on DeepSeek at once — the turn
      // keeps its draft, and the next turn goes to DeepSeek.
      const polishOnly = new HostCircuit({
        onTransition: (state, reason) =>
          circuitLogger.warn(`command code polish ${state}: ${reason}`),
      });
      return {
        name: polisher.name,
        polish: async (req) => {
          if (commandCodeCircuit.isOpen() || polishOnly.isOpen()) {
            return fallback ? fallback.polish(req) : null;
          }
          try {
            return await polisher.polish(req);
          } catch (err) {
            if (isUsageLimitError(err)) commandCodeCircuit.trip('usage limit');
            else tripOnPersistentFailure(polishOnly, err);
            throw err;
          }
        },
      };
    },
  });

  // Minutes over a FINISHED conversation, not a live turn. Selected by name,
  // like the respeller and the polisher: `MinutesSummarizer` reads
  // AI_SUMMARIZATION_PROVIDER, or follows AI_TRANSLATION_PROVIDER when that is
  // unset. Each entry owns its endpoint and its model, so a host is one more
  // entry here rather than another branch inside one.
  //
  // `commandcode` writes with Command Code's gemini-3.7-flash and hands any
  // failure to Gemini direct: chosen by the 2026-10-29 minutes bench, where it
  // judged at least as useful as gemini-3.5-flash direct (8.08 against 7.75)
  // at 5.9 s against 9.6 s, and never emitted an injection canary
  // (plans/reports/brainstorm-261029-0923-command-code-other-ai-parts.md).
  const minutesQuotaCooldown = ({
    model,
    cooldownMs,
  }: {
    model: string;
    cooldownMs: number;
  }) => {
    recordQuotaCooldown(model);
    quotaLogger.warn(`rate limited on ${model}; cooling for ${cooldownMs}ms`);
  };
  registry.register('summarization', {
    name: 'gemini',
    create: (cfg: ProviderConfig): SummarizationProvider => {
      const c = cfg as AiProviderResolveConfig;
      return new GeminiSummarizationProvider({
        apiKey: c.geminiApiKey,
        onQuotaCooldown: minutesQuotaCooldown,
      });
    },
  });
  registry.register('summarization', {
    name: 'commandcode',
    create: (cfg: ProviderConfig): SummarizationProvider => {
      const c = cfg as AiProviderResolveConfig;
      // No key-presence guard: a missing Command Code key throws here, as the
      // translation entries do, rather than quietly answering from Gemini.
      // Gemini is only the fallback, so it may be absent.
      return new FailoverSummarizationProvider({
        name: 'commandcode',
        primary: new OpenAiCompatibleSummarizationProvider({
          apiKey: c.commandCodeApiKey,
          baseUrl: COMMAND_CODE_BASE_URL,
          model: 'google/gemini-3.7-flash',
          name: 'commandcode-minutes',
        }),
        secondary: c.geminiApiKey
          ? new GeminiSummarizationProvider({
              apiKey: c.geminiApiKey,
              onQuotaCooldown: minutesQuotaCooldown,
            })
          : null,
        circuit: commandCodeCircuit,
      });
    },
  });

  // The only synthesizer: one local backend covers every output language; the
  // sidecar picks the engine from the language and owns each one's default
  // voice. Resolved with `resolveOnly`, like the recognizer above.
  registry.register('tts', {
    name: 'local',
    create: (cfg: ProviderConfig) => {
      const c = cfg as AiProviderResolveConfig;
      return new LocalSpeechTtsProvider({ baseUrl: c.localTtsUrl });
    },
  });

  return registry;
}

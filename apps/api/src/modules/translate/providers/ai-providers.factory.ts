import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistry,
  type SpeakerEmbeddingProvider,
  type SttProvider,
  type TranslationProvider,
  type TtsProvider,
} from '@chatofy/ai-providers';
import { Env } from '../../../config/env.schema';
import type { AiProviderResolveConfig } from './register-default-providers';

/** Resolved provider trio for a single translation turn. */
export interface PipelineProviders {
  stt: SttProvider;
  translation: TranslationProvider;
  tts: TtsProvider;
}

/**
 * Builds the concrete provider trio from the env selections. Concrete
 * construction lives in the ProviderRegistry (populated at the composition root
 * — see register-default-providers.ts), so this factory never names a backend:
 * unknown selections surface as the registry's ProviderNotImplementedError.
 *
 * Key presence is enforced lazily by the provider constructors (they throw
 * ProviderConfigError) — so the app and existing e2e tests boot without keys,
 * and a missing key only surfaces when /translate is actually called.
 */
@Injectable()
export class AiProvidersFactory {
  // Keyed by the selected backend names, which are read from config on every
  // call — so a changed selection can never serve a stale trio, and a stable
  // one keeps the GoogleGenAI client + its keep-alive connection pool warm
  // across requests instead of rebuilding them on every call.
  private readonly cache = new Map<string, PipelineProviders>();
  /**
   * The embedding backend, kept warm the same way the trio is.
   *
   * Its own field rather than a fourth member of the trio: it is resolved for
   * some turns and not others, and folding it in would make every turn build one
   * whether or not anybody asked.
   */
  private speakerEmbedding: SpeakerEmbeddingProvider | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Every provider handles both languages, so the trio no longer depends on
   * the translation direction — each backend is told the language per call.
   */
  makeProviders(): PipelineProviders {
    const sttName = this.config.get('AI_STT_PROVIDER', { infer: true });
    const ttsName = this.config.get('AI_TTS_PROVIDER', { infer: true });
    const translationName = this.config.get('AI_TRANSLATION_PROVIDER', {
      infer: true,
    });

    const key = [sttName, ttsName, translationName].join('|');

    const cached = this.cache.get(key);
    if (cached) return cached;

    const resolveConfig: AiProviderResolveConfig = {
      elevenLabsApiKey: this.config.get('ELEVENLABS_API_KEY', { infer: true }),
      // Passed through raw. One key or a comma-separated pool are the same
      // variable, and splitting it is the provider's job — it owns what counts
      // as a usable key.
      geminiApiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
      elevenLabsTtsVoiceId: this.config.get('ELEVENLABS_TTS_VOICE_ID', {
        infer: true,
      }),
      localSttUrl: this.config.get('LOCAL_STT_URL', { infer: true }),
      localTtsUrl: this.config.get('LOCAL_TTS_URL', { infer: true }),
    };

    const trio: PipelineProviders = {
      stt: this.registry.resolve('stt', sttName, resolveConfig),
      translation: this.registry.resolve(
        'translation',
        translationName,
        resolveConfig,
      ),
      tts: this.registry.resolve('tts', ttsName, resolveConfig),
    };
    this.cache.set(key, trio);
    return trio;
  }

  /**
   * The speaker-embedding backend.
   *
   * `resolveOnly`, like the realtime provider: no environment variable selects
   * one, so a second registration should be a loud error rather than a silent
   * pick.
   */
  makeSpeakerEmbedding(): SpeakerEmbeddingProvider {
    this.speakerEmbedding ??= this.registry.resolveOnly('speakerEmbedding', {
      localSttUrl: this.config.get('LOCAL_STT_URL', { infer: true }),
    } satisfies AiProviderResolveConfig);
    return this.speakerEmbedding;
  }
}

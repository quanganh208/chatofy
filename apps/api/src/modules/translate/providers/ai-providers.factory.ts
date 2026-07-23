import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistry,
  type QualityProfile,
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
 * Builds the concrete provider trio from env selections + a resolved quality
 * profile. Concrete construction lives in the ProviderRegistry (populated at
 * the composition root — see register-default-providers.ts), so this factory
 * never names a backend: unknown selections surface as the registry's
 * ProviderNotImplementedError.
 *
 * Key presence is enforced lazily by the provider constructors (they throw
 * ProviderConfigError) — so the app and existing e2e tests boot without keys,
 * and a missing key only surfaces when /translate is actually called.
 */
@Injectable()
export class AiProvidersFactory {
  // The tier set is fixed (3 profiles), so a per-instance cache stays bounded.
  // Reusing the trio keeps the GoogleGenAI client + its keep-alive connection
  // pool warm across requests instead of rebuilding them on every call.
  private readonly cache = new Map<string, PipelineProviders>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Every provider handles both languages, so the trio no longer depends on
   * the translation direction — each backend is told the language per call.
   */
  makeProviders(profile: QualityProfile): PipelineProviders {
    const sttName = this.config.get('AI_STT_PROVIDER', { infer: true });
    const ttsName = this.config.get('AI_TTS_PROVIDER', { infer: true });
    const translationName = this.config.get('AI_TRANSLATION_PROVIDER', {
      infer: true,
    });

    // Provider names are part of the key so switching a backend can never
    // serve a stale trio.
    const key = [
      sttName,
      ttsName,
      translationName,
      profile.sttModel,
      profile.translationModel,
      profile.thinkingBudget,
      profile.ttsModel,
    ].join('|');

    const cached = this.cache.get(key);
    if (cached) return cached;

    const resolveConfig: AiProviderResolveConfig = {
      elevenLabsApiKey: this.config.get('ELEVENLABS_API_KEY', { infer: true }),
      geminiApiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
      elevenLabsTtsVoiceId: this.config.get('ELEVENLABS_TTS_VOICE_ID', {
        infer: true,
      }),
      localSttUrl: this.config.get('LOCAL_STT_URL', { infer: true }),
      localTtsUrl: this.config.get('LOCAL_TTS_URL', { infer: true }),
      sttModel: profile.sttModel,
      translationModel: profile.translationModel,
      ttsModel: profile.ttsModel,
      thinkingBudget: profile.thinkingBudget,
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
}

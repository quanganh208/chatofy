import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistry,
  type QualityProfile,
  type SttProvider,
  type TranslationProvider,
  type TtsProvider,
} from '@chatofy/ai-providers';
import type { LanguageCode } from '@chatofy/types';
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
   * @param targetLang Output language — selects the TTS provider (en→ElevenLabs,
   *   vi→VieNeu). Defaults to 'en' so existing vi→en callers are unchanged.
   */
  makeProviders(
    profile: QualityProfile,
    targetLang: LanguageCode = 'en',
  ): PipelineProviders {
    const sttName = this.config.get('AI_STT_PROVIDER', { infer: true });
    const ttsName = this.config.get('AI_TTS_PROVIDER', { infer: true });
    const translationName = this.config.get('AI_TRANSLATION_PROVIDER', {
      infer: true,
    });
    // TTS is routed by output language, not by AI_TTS_PROVIDER: Vietnamese always
    // uses the local VieNeu sidecar; English honours the configured provider.
    const ttsBackend = targetLang === 'vi' ? 'vieneu' : ttsName;

    // targetLang + provider names are part of the key so a switch (of backend or
    // direction) can never serve a stale trio built for a different output.
    const key = [
      sttName,
      ttsBackend,
      translationName,
      targetLang,
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
      vieNeuTtsUrl: this.config.get('VIENEU_TTS_URL', { infer: true }),
      vieNeuTtsVoice: this.config.get('VIENEU_TTS_VOICE', { infer: true }),
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
      tts: this.registry.resolve('tts', ttsBackend, resolveConfig),
    };
    this.cache.set(key, trio);
    return trio;
  }
}

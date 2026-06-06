import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ElevenLabsSttProvider,
  ElevenLabsTtsProvider,
  GeminiTranslationProvider,
  ProviderNotImplementedError,
  type QualityProfile,
  type SttProvider,
  type TranslationProvider,
  type TtsProvider,
} from '@chatofy/ai-providers';
import { Env } from '../../../config/env.schema';

/** Resolved provider trio for a single translation turn. */
export interface PipelineProviders {
  stt: SttProvider;
  translation: TranslationProvider;
  tts: TtsProvider;
}

/**
 * Builds the concrete provider trio from env selections + a resolved quality
 * profile. A fresh trio is constructed per request so the tier model (which
 * varies with the quality slider) is carried via each provider instance.
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

  constructor(private readonly config: ConfigService<Env, true>) {}

  makeProviders(profile: QualityProfile): PipelineProviders {
    const sttName = this.config.get('AI_STT_PROVIDER', { infer: true });
    const ttsName = this.config.get('AI_TTS_PROVIDER', { infer: true });
    const translationName = this.config.get('AI_TRANSLATION_PROVIDER', {
      infer: true,
    });

    if (sttName !== 'elevenlabs')
      throw new ProviderNotImplementedError(`stt:${sttName}`);
    if (ttsName !== 'elevenlabs')
      throw new ProviderNotImplementedError(`tts:${ttsName}`);
    if (translationName !== 'gemini') {
      throw new ProviderNotImplementedError(`translation:${translationName}`);
    }

    // Provider names are part of the key so a runtime provider switch can never
    // serve a stale trio built for a different backend.
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

    const elevenKey = this.config.get('ELEVENLABS_API_KEY', { infer: true });
    const geminiKey = this.config.get('GEMINI_API_KEY', { infer: true });
    const voice = this.config.get('ELEVENLABS_TTS_VOICE_ID', { infer: true });

    const trio: PipelineProviders = {
      stt: new ElevenLabsSttProvider({
        apiKey: elevenKey,
        model: profile.sttModel,
      }),
      translation: new GeminiTranslationProvider({
        apiKey: geminiKey,
        model: profile.translationModel,
        thinkingBudget: profile.thinkingBudget,
      }),
      tts: new ElevenLabsTtsProvider({
        apiKey: elevenKey,
        voice,
        model: profile.ttsModel,
      }),
    };
    this.cache.set(key, trio);
    return trio;
  }
}

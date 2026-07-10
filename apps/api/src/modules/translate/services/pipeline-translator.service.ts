import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderNotImplementedError,
  resolveQualityProfile,
} from '@chatofy/ai-providers';
import {
  directionLanguages,
  type TranslateResponse,
  type TranslationDirection,
} from '@chatofy/types';
import { AiProvidersFactory } from '../providers/ai-providers.factory';

/** Decoded input for one translation turn. */
export interface TranslateTurnInput {
  audio: Uint8Array;
  mimeType: string;
  quality: number;
  /** Translation direction; defaults to vi→en for backward compatibility. */
  direction?: TranslationDirection;
  /** Optional output voice (VieNeu preset name for en→vi). */
  voice?: string;
}

// Nominal format passed to TTS; providers emit their own container regardless.
const AUDIO_FORMAT = {
  encoding: 'pcm16',
  sampleRate: 44100,
  channels: 1,
} as const;
// Output container per target language: ElevenLabs emits mp3, VieNeu emits wav.
const OUTPUT_MIME_BY_LANG: Record<'vi' | 'en', string> = {
  en: 'audio/mpeg',
  vi: 'audio/wav',
};

/**
 * Orchestrates one turn-based translation: STT → translate → TTS.
 * Languages follow the requested direction (vi→en or en→vi); the target language
 * selects the TTS provider (en→ElevenLabs, vi→VieNeu) via the factory.
 * Provider errors are mapped to HTTP exceptions so the response envelope carries
 * a meaningful status instead of a raw 500.
 */
@Injectable()
export class PipelineTranslatorService {
  private readonly logger = new Logger(PipelineTranslatorService.name);

  constructor(private readonly providers: AiProvidersFactory) {}

  async translateTurn(input: TranslateTurnInput): Promise<TranslateResponse> {
    const quality = Math.min(1, Math.max(0, input.quality));
    const direction: TranslationDirection = input.direction ?? 'vi_to_en';
    const { source, target } = directionLanguages(direction);
    const profile = resolveQualityProfile(quality);

    try {
      const trio = this.providers.makeProviders(profile, target);

      const sttStart = Date.now();
      const { text: sourceText } = await trio.stt.transcribe(
        input.audio,
        input.mimeType,
        source,
      );
      this.logger.log(`stt(${profile.sttModel}) ${Date.now() - sttStart}ms`);
      if (!sourceText.trim()) {
        throw new BadRequestException('No speech detected in the audio');
      }

      const trStart = Date.now();
      const { text: targetText } = await trio.translation.translate({
        text: sourceText,
        sourceLanguage: source,
        targetLanguage: target,
      });
      this.logger.log(
        `translate(${profile.translationModel}) ${Date.now() - trStart}ms`,
      );

      const ttsStart = Date.now();
      const audioBytes = await trio.tts.synthesize({
        text: targetText,
        language: target,
        audioFormat: AUDIO_FORMAT,
        voice: input.voice,
      });
      this.logger.log(`tts(${profile.ttsModel}) ${Date.now() - ttsStart}ms`);

      return {
        sourceText,
        targetText,
        audioBase64: Buffer.from(audioBytes).toString('base64'),
        audioMimeType: OUTPUT_MIME_BY_LANG[target],
        quality,
      };
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  private handlePipelineError(err: unknown): never {
    if (err instanceof BadRequestException) throw err;
    if (err instanceof ProviderConfigError) {
      this.logger.error(`Provider misconfigured: ${err.message}`);
      throw new ServiceUnavailableException(
        'Translation provider is not configured',
      );
    }
    if (err instanceof ProviderNotImplementedError) {
      this.logger.error(err.message);
      throw new ServiceUnavailableException(
        'Selected translation provider is not available',
      );
    }
    if (err instanceof ProviderConnectionError) {
      this.logger.error(`Provider request failed: ${err.message}`);
      throw new ServiceUnavailableException(
        'Translation provider request failed',
      );
    }
    throw err;
  }
}

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
import type { TranslateResponse } from '@chatofy/types';
import { AiProvidersFactory } from '../providers/ai-providers.factory';

/** Decoded input for one translation turn. */
export interface TranslateTurnInput {
  audio: Uint8Array;
  mimeType: string;
  quality: number;
}

// Nominal format passed to TTS; the ElevenLabs provider emits mp3 regardless.
const AUDIO_FORMAT = {
  encoding: 'pcm16',
  sampleRate: 44100,
  channels: 1,
} as const;
const OUTPUT_MIME = 'audio/mpeg';

/**
 * Orchestrates one turn-based vi→en translation: STT → translate → TTS.
 * Provider instances are built per request from the resolved quality profile.
 * Provider errors are mapped to HTTP exceptions so the response envelope carries
 * a meaningful status instead of a raw 500.
 */
@Injectable()
export class PipelineTranslatorService {
  private readonly logger = new Logger(PipelineTranslatorService.name);

  constructor(private readonly providers: AiProvidersFactory) {}

  async translateTurn(input: TranslateTurnInput): Promise<TranslateResponse> {
    const quality = Math.min(1, Math.max(0, input.quality));
    const profile = resolveQualityProfile(quality);

    try {
      const trio = this.providers.makeProviders(profile);

      const sttStart = Date.now();
      const { text: sourceText } = await trio.stt.transcribe(
        input.audio,
        input.mimeType,
        'vi',
      );
      this.logger.log(`stt(${profile.sttModel}) ${Date.now() - sttStart}ms`);
      if (!sourceText.trim()) {
        throw new BadRequestException('No speech detected in the audio');
      }

      const trStart = Date.now();
      const { text: targetText } = await trio.translation.translate({
        text: sourceText,
        sourceLanguage: 'vi',
        targetLanguage: 'en',
      });
      this.logger.log(
        `translate(${profile.translationModel}) ${Date.now() - trStart}ms`,
      );

      const ttsStart = Date.now();
      const audioBytes = await trio.tts.synthesize({
        text: targetText,
        language: 'en',
        audioFormat: AUDIO_FORMAT,
      });
      this.logger.log(`tts(${profile.ttsModel}) ${Date.now() - ttsStart}ms`);

      return {
        sourceText,
        targetText,
        audioBase64: Buffer.from(audioBytes).toString('base64'),
        audioMimeType: OUTPUT_MIME,
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

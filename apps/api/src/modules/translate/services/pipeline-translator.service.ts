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
  ProviderResponseError,
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
  /** Translation direction; defaults to vi→en for backward compatibility. */
  direction?: TranslationDirection;
  /** Optional output voice, interpreted by the TTS backend for the output language. */
  voice?: string;
}

// Nominal format passed to TTS; providers emit their own container regardless.
const AUDIO_FORMAT = {
  encoding: 'pcm16',
  sampleRate: 44100,
  channels: 1,
} as const;

/**
 * Orchestrates one turn-based translation: STT → translate → TTS.
 * Languages follow the requested direction (vi→en or en→vi) and are passed to
 * each provider, every one of which handles both.
 * Provider errors are mapped to HTTP exceptions so the response envelope carries
 * a meaningful status instead of a raw 500.
 */
@Injectable()
export class PipelineTranslatorService {
  private readonly logger = new Logger(PipelineTranslatorService.name);

  constructor(private readonly providers: AiProvidersFactory) {}

  async translateTurn(input: TranslateTurnInput): Promise<TranslateResponse> {
    const direction: TranslationDirection = input.direction ?? 'vi_to_en';
    const { source, target } = directionLanguages(direction);

    try {
      const trio = this.providers.makeProviders();

      const sttStart = Date.now();
      const { text: sourceText } = await trio.stt.transcribe(
        input.audio,
        input.mimeType,
        source,
      );
      this.logger.log(`stt(${trio.stt.name}) ${Date.now() - sttStart}ms`);
      if (!sourceText.trim()) {
        throw new BadRequestException('No speech detected in the audio');
      }

      const trStart = Date.now();
      const { text: targetText, model: translationModel } =
        await trio.translation.translate({
          text: sourceText,
          sourceLanguage: source,
          targetLanguage: target,
        });
      // Report the model that answered: the provider walks down its own model
      // list as each one's daily quota runs out, so only the result can say
      // which model actually ran. Backends that do not report one fall back to
      // the provider name.
      this.logger.log(
        `translate(${translationModel ?? trio.translation.name}) ${Date.now() - trStart}ms`,
      );

      const ttsStart = Date.now();
      const audioBytes = await trio.tts.synthesize({
        text: targetText,
        language: target,
        audioFormat: AUDIO_FORMAT,
        voice: input.voice,
      });
      this.logger.log(`tts(${trio.tts.name}) ${Date.now() - ttsStart}ms`);

      return {
        sourceText,
        targetText,
        audioBase64: Buffer.from(audioBytes).toString('base64'),
        // The provider that synthesized the audio owns its container format.
        audioMimeType: trio.tts.outputMimeType,
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
      // Log the wrapped cause too: the provider message alone ("… request
      // failed") cannot distinguish a down sidecar from a rejected API key,
      // which makes a transport failure undiagnosable from the logs.
      this.logger.error(
        `Provider request failed: ${err.message}`,
        err.cause instanceof Error ? err.cause.stack : String(err.cause),
      );
      throw new ServiceUnavailableException(
        'Translation provider request failed',
      );
    }
    if (err instanceof ProviderResponseError) {
      this.logger.error(
        `Provider returned an unusable response: ${err.message}`,
      );
      throw new ServiceUnavailableException(
        'Translation provider request failed',
      );
    }
    throw err;
  }
}

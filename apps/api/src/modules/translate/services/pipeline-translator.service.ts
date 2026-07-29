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
  type LanguageCode,
  type TranslateResponse,
  type TranslationDirection,
  type VoiceGender,
} from '@chatofy/types';
import { AiProvidersFactory } from '../providers/ai-providers.factory';

/** Decoded input for one translation turn. */
export interface TranslateTurnInput {
  audio: Uint8Array;
  mimeType: string;
  /** Translation direction; defaults to vi→en for backward compatibility. */
  direction?: TranslationDirection;
  /** Which voice speaks the translation; the TTS backend defaults an omitted one. */
  voiceGender?: VoiceGender;
  /**
   * Translation models to try, in order, instead of the provider's own list.
   *
   * The streaming path sets this; REST does not, so the baseline keeps the
   * provider's full ladder including its slow last resort. See
   * `translation-session.service.ts` for why a live turn cannot afford that one.
   */
  models?: string[];
}

/** The text half of a turn — everything decided before speech is synthesized. */
export interface TranslatedTurnText {
  sourceText: string;
  targetText: string;
  /** Language the target text must be spoken in. */
  targetLanguage: LanguageCode;
}

/** One synthesis request. */
export interface SynthesizeRequest {
  text: string;
  language: LanguageCode;
  voiceGender?: VoiceGender;
}

/** Synthesized speech plus the container the backend chose for it. */
export interface SynthesizedSpeech {
  bytes: Uint8Array;
  mimeType: string;
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

  /**
   * One whole turn, synthesized in a single call.
   *
   * This is the REST shape and the measurement baseline the streaming path is
   * compared against, so the audio must keep coming from ONE `synthesize` call:
   * the streaming path splits the text into clauses, which changes prosody at
   * the seams and would stop this being a like-for-like comparison.
   */
  async translateTurn(input: TranslateTurnInput): Promise<TranslateResponse> {
    const { sourceText, targetText, targetLanguage } =
      await this.transcribeAndTranslate(input);

    const speech = await this.synthesize({
      text: targetText,
      language: targetLanguage,
      voiceGender: input.voiceGender,
    });

    return {
      sourceText,
      targetText,
      audioBase64: Buffer.from(speech.bytes).toString('base64'),
      audioMimeType: speech.mimeType,
    };
  }

  /**
   * Transcribe only, with no opinion about whether anything was said.
   *
   * Split out for the live transcript, which decodes the same utterance over
   * and over as it grows. Its first attempts run on a moment of pre-roll and
   * routinely come back empty — which is the recogniser working, not failing.
   * The "no speech detected" rejection therefore belongs to whoever asked for a
   * whole turn, and lives one level up in {@link transcribeAndTranslate}.
   */
  async transcribe(input: TranslateTurnInput): Promise<string> {
    const direction: TranslationDirection = input.direction ?? 'vi_to_en';
    const { source } = directionLanguages(direction);

    try {
      const trio = this.providers.makeProviders();
      const sttStart = Date.now();
      const { text } = await trio.stt.transcribe(
        input.audio,
        input.mimeType,
        source,
      );
      this.logger.log(`stt(${trio.stt.name}) ${Date.now() - sttStart}ms`);
      return text;
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /**
   * Translate text that has already been transcribed.
   *
   * Split out for the live translation, which works from the running transcript
   * rather than from audio, so re-transcribing to reach the translator would
   * pay twice for a reading it already has.
   */
  async translate(req: {
    text: string;
    direction?: TranslationDirection;
    models?: string[];
  }): Promise<string> {
    const { source, target } = directionLanguages(req.direction ?? 'vi_to_en');

    try {
      const trio = this.providers.makeProviders();
      const start = Date.now();
      const { text, model } = await trio.translation.translate({
        text: req.text,
        sourceLanguage: source,
        targetLanguage: target,
        models: req.models,
      });
      this.logger.log(
        `translate(${model ?? trio.translation.name}) ${Date.now() - start}ms`,
      );
      return text;
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /**
   * Transcribe and translate, stopping before synthesis.
   *
   * Split out for the streaming path, which needs the text on its own twice
   * over: to synthesize it clause by clause, and to run this half early on a
   * suspected end-of-speech while the endpoint is still being confirmed.
   */
  async transcribeAndTranslate(
    input: TranslateTurnInput,
  ): Promise<TranslatedTurnText> {
    const direction: TranslationDirection = input.direction ?? 'vi_to_en';
    const { source, target } = directionLanguages(direction);

    try {
      const trio = this.providers.makeProviders();

      const sourceText = await this.transcribe(input);
      if (!sourceText.trim()) {
        throw new BadRequestException('No speech detected in the audio');
      }

      const trStart = Date.now();
      const { text: targetText, model: translationModel } =
        await trio.translation.translate({
          text: sourceText,
          sourceLanguage: source,
          targetLanguage: target,
          models: input.models,
        });
      // Report the model that answered: the provider walks down its own model
      // list as each one's daily quota runs out, so only the result can say
      // which model actually ran. Backends that do not report one fall back to
      // the provider name.
      this.logger.log(
        `translate(${translationModel ?? trio.translation.name}) ${Date.now() - trStart}ms`,
      );

      return { sourceText, targetText, targetLanguage: target };
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /** Synthesize one piece of text — a whole turn for REST, one clause for WS. */
  async synthesize(req: SynthesizeRequest): Promise<SynthesizedSpeech> {
    try {
      const trio = this.providers.makeProviders();

      const ttsStart = Date.now();
      const bytes = await trio.tts.synthesize({
        text: req.text,
        language: req.language,
        audioFormat: AUDIO_FORMAT,
        voiceGender: req.voiceGender,
      });
      this.logger.log(`tts(${trio.tts.name}) ${Date.now() - ttsStart}ms`);

      // The provider that synthesized the audio owns its container format.
      return { bytes, mimeType: trio.tts.outputMimeType };
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

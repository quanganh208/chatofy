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
  type TranslationHints,
  type TtsVoice,
} from '@chatofy/ai-providers';
import {
  directionLanguages,
  type LanguageCode,
  type TranslateResponse,
  type TranslationDirection,
  type VoiceGender,
} from '@chatofy/types';
import { AiProvidersFactory } from '../providers/ai-providers.factory';

/**
 * How long a fetched voice catalog is reused.
 *
 * The web app asks on every mount and this fans out to a sidecar whose CPU is
 * being spent on speech. Short enough that restarting the speech backend is
 * picked up without restarting the api.
 */
const VOICE_CACHE_TTL_MS = 60_000;

/** Decoded input for one translation turn. */
export interface TranslateTurnInput {
  audio: Uint8Array;
  mimeType: string;
  /** Translation direction; defaults to vi→en for backward compatibility. */
  direction?: TranslationDirection;
  /** Which voice speaks the translation; the TTS backend defaults an omitted one. */
  voiceGender?: VoiceGender;
  /** Speaking rate; ignored by backends that have no rate control. */
  speed?: number;
  /**
   * Translation models to try, in order, instead of the provider's own list.
   *
   * The streaming path sets this; REST does not, so the baseline keeps the
   * provider's full ladder including its slow last resort. See
   * `translation-session.service.ts` for why a live turn cannot afford that one.
   */
  models?: string[];
  /**
   * Conversation-level hints for the translator, fixed for the whole session.
   *
   * Set once when the session opens and carried on every turn of it, because
   * what the conversation is about does not change between one sentence and the
   * next — and re-deciding it per turn would let the topic drift mid-session.
   */
  hints?: TranslationHints;
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
  /**
   * Speaking rate. Backends that have no rate control ignore it — the Vietnamese
   * engine is one, so this changes nothing for `vi` output and the UI says so
   * rather than offering a control that silently does nothing.
   */
  speed?: number;
  /**
   * A specific voice, as a token the running backend published.
   *
   * Forwarded ONLY to a provider that implements `listVoices` — see `synthesize`.
   * A backend that advertises no catalog cannot have produced this token, so
   * handing it one would be handing it a value from somewhere else entirely.
   */
  voice?: string;
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
  /** Per-language voice catalog, with the wall-clock time it goes stale. */
  private readonly voiceCache = new Map<
    LanguageCode,
    { voices: TtsVoice[]; expiresAt: number }
  >();

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
      speed: input.speed,
    });

    return {
      sourceText,
      targetText,
      audioBase64: Buffer.from(speech.bytes).toString('base64'),
      audioMimeType: speech.mimeType,
    };
  }

  /**
   * A voice vector for one turn, or `null` if anything went wrong.
   *
   * **Never throws, and that is the contract.** Attribution is an enhancement on
   * a translator: a sidecar that is down, slow or upset must cost a label, not a
   * translation. Every other failure in this file routes through
   * `handlePipelineError` and ends the turn; this one is logged and swallowed.
   *
   * The caller must start this BESIDE transcription rather than after it. The
   * whole reason the sidecar exposes a second endpoint is so this cost lands in
   * parallel with work that was happening anyway; awaited at the call site it
   * becomes serial and buys nothing.
   */
  async embedSpeaker(input: TranslateTurnInput): Promise<number[] | null> {
    try {
      const provider = this.providers.makeSpeakerEmbedding();
      const start = Date.now();
      const { vector } = await provider.embed(input.audio, input.mimeType);
      this.logger.log(`embed(${provider.name}) ${Date.now() - start}ms`);
      return vector;
    } catch (err) {
      this.logger.warn(
        `speaker embedding failed, turn continues unattributed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
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
    hints?: TranslationHints;
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
        hints: req.hints,
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
          hints: input.hints,
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
  /**
   * Voices the configured TTS backend offers, cached briefly.
   *
   * Empty when the backend publishes no catalog — which is a real answer meaning
   * "no choice here", not a failure. A backend without `listVoices` is also the
   * one that must never be sent a voice token, and `synthesize` enforces that
   * with the same check.
   *
   * The cache exists because the web app asks on every mount and this call fans
   * out to a sidecar that is busy synthesizing speech. Short enough that a
   * restarted backend is picked up without anyone restarting the api.
   */
  async listVoices(language: LanguageCode): Promise<TtsVoice[]> {
    const cached = this.voiceCache.get(language);
    if (cached && Date.now() < cached.expiresAt) return cached.voices;

    const trio = this.providers.makeProviders();
    if (!trio.tts.listVoices) return [];

    const voices = await trio.tts.listVoices(language);
    this.voiceCache.set(language, {
      voices,
      expiresAt: Date.now() + VOICE_CACHE_TTL_MS,
    });
    return voices;
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizedSpeech> {
    try {
      const trio = this.providers.makeProviders();

      const ttsStart = Date.now();
      // A voice token goes only to the provider that could have published it.
      // `listVoices` is the capability check AND the gate: a backend with no
      // catalog never sees a token, so a value saved while a different backend
      // was configured cannot reach code that might interpolate it somewhere.
      // That is the shape of a real outage this guards against, not a hypothetical.
      const voice = trio.tts.listVoices ? req.voice : undefined;
      const bytes = await trio.tts.synthesize({
        speed: req.speed,
        ...(voice ? { voice } : {}),
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
      // Same reason the connection branch below logs its cause: "misconfigured"
      // does not distinguish a missing key from one the API rejected, and the
      // rejection body is the only thing that says which remedy applies.
      this.logger.error(
        `Provider misconfigured: ${err.message}`,
        err.cause instanceof Error ? err.cause.stack : undefined,
      );
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

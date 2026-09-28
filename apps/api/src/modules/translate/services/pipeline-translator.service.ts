import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderAbortedError,
  ProviderBusyError,
  ProviderConfigError,
  ProviderConnectionError,
  ProviderNotImplementedError,
  ProviderResponseError,
  type SpeakerEmbeddingResult,
  type TranslationHints,
  type TtsAudioStream,
  type TtsProvider,
  type TtsSynthesizeRequest,
  type TtsVoiceCatalog,
} from '@chatofy/ai-providers';
import {
  type LanguageCode,
  type TranslateResponse,
  type VoiceGender,
} from '@chatofy/types';
import { AiProvidersFactory } from '../providers/ai-providers.factory';
import type {
  TurnLanguagePlan,
  TranslationMap,
} from '../session/turn-language-plan';

/**
 * How long a fetched voice catalog is reused.
 *
 * The web app asks on every mount and this fans out to a sidecar whose CPU is
 * being spent on speech. Short enough that restarting the speech backend is
 * picked up without restarting the api.
 */
const VOICE_CACHE_TTL_MS = 60_000;

/**
 * The speech engine was serving another turn for longer than this one could
 * wait for it.
 *
 * Still a 503 with the same message a REST caller has always had, so
 * that contract is unchanged; its own class so a live turn can tell "lost the
 * queue" from "the backend is broken" and end without audio instead of failing.
 */
export class SpeechEngineBusyException extends ServiceUnavailableException {
  constructor() {
    super('Translation provider request failed');
  }
}

/**
 * Decoded input for one translation turn.
 *
 * Carries no language of its own: which language(s) to recognise, and which to
 * translate into, are the caller's `TurnLanguagePlan`, passed as its own
 * argument to every method that needs one below. Keeping the plan out of this
 * object is what lets `transcribe`/`translate` take a single language directly
 * while `transcribeAndTranslate`/`translateTurn` take the whole plan, without
 * the type lying about which fields either path actually reads.
 */
export interface TranslateTurnInput {
  audio: Uint8Array;
  mimeType: string;
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
  /**
   * Source utterances that already finished on this connection, oldest first.
   *
   * The opposite of {@link hints} in every way that matters: it changes every
   * turn, it comes from the speaker rather than the operator, and it exists for
   * the turns hints cannot help — a two-word fragment that means nothing without
   * the sentence it is inside. Passed straight to the translator, which owns how
   * much of it a prompt can afford.
   */
  context?: string[];
}

/**
 * The text half of a turn — everything decided before speech is synthesized.
 *
 * `translations` replaces the single `targetText`/`targetLanguage` this used to
 * carry: a turn is translated into every one of its plan's `targets`, not only
 * the one that gets spoken. A caller that wants the spoken text reads
 * `translations[plan.spoken]`.
 */
export interface TranslatedTurnText {
  sourceText: string;
  translations: TranslationMap;
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
 * The provider request for one synthesis, shared by the whole-WAV and the
 * streamed path so the two cannot disagree about which voice a backend is sent.
 *
 * A voice token goes only to the provider that could have published it.
 * `listVoices` is the capability check AND the gate: a backend with no catalog
 * never sees a token, so a value saved while a different backend was configured
 * cannot reach code that might interpolate it somewhere. That is the shape of a
 * real outage this guards against, not a hypothetical.
 */
function ttsRequestFor(
  tts: TtsProvider,
  req: SynthesizeRequest,
): TtsSynthesizeRequest & { voice?: string } {
  const voice = tts.listVoices ? req.voice : undefined;
  return {
    speed: req.speed,
    ...(voice ? { voice } : {}),
    text: req.text,
    language: req.language,
    audioFormat: AUDIO_FORMAT,
    voiceGender: req.voiceGender,
  };
}

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
    TtsVoiceCatalog & { expiresAt: number }
  >();

  constructor(private readonly providers: AiProvidersFactory) {}

  /**
   * One whole turn, synthesized in a single call.
   *
   * This is the REST shape and the measurement baseline the streaming path is
   * compared against, so the audio must keep coming from ONE `synthesize` call:
   * the streaming path splits the text into clauses, which changes prosody at
   * the seams and would stop this being a like-for-like comparison.
   *
   * REST answers ONE audio, for `plan.spoken` — the same budget the streaming
   * path applies to its preview, made explicit here in the swagger docs on
   * `TranslateController`. A fan-out turn still translates into every one of
   * `plan.targets`; only the synthesized side is singular.
   */
  async translateTurn(
    input: TranslateTurnInput,
    plan: TurnLanguagePlan,
  ): Promise<TranslateResponse> {
    const { sourceText, translations } = await this.transcribeAndTranslate(
      input,
      plan,
    );
    const targetText = translations[plan.spoken] ?? '';

    const speech = await this.synthesize({
      text: targetText,
      language: plan.spoken,
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
  async embedSpeaker(
    input: TranslateTurnInput,
  ): Promise<SpeakerEmbeddingResult | null> {
    try {
      const provider = this.providers.makeSpeakerEmbedding();
      const start = Date.now();
      // The whole result, not just the vector. `speechMs` is what tells the
      // client whether the vector means anything — a turn under the floor
      // carries no speaker information, and dropping the field here would put
      // the decision back where it cannot be made.
      const result = await provider.embed(input.audio, input.mimeType);
      this.logger.log(`embed(${provider.name}) ${Date.now() - start}ms`);
      return result;
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
  async transcribe(
    input: TranslateTurnInput & { language: LanguageCode },
  ): Promise<string> {
    try {
      const trio = this.providers.makeProviders();
      const sttStart = Date.now();
      const { text } = await trio.stt.transcribe(
        input.audio,
        input.mimeType,
        input.language,
        // The same hints the translator gets. A hotword is named because the
        // RECOGNIZER mishears it, so spending the list here first is what the
        // field was always for; the translator still receives it, for the term
        // that biasing does not recover.
        { hotwords: input.hints?.hotwords },
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
    source: LanguageCode;
    target: LanguageCode;
    models?: string[];
    hints?: TranslationHints;
    /** Finished source utterances from earlier in this conversation, oldest first. */
    context?: string[];
    /**
     * Called with each piece of the translation as it is written.
     *
     * Passed straight through; a provider that cannot stream never calls it.
     * `restart` marks the first piece of an attempt — a provider may abandon
     * one key and retry on another, and a caller that appends blindly would
     * splice two different translations together.
     */
    onChunk?: (delta: string, restart: boolean) => void;
  }): Promise<string> {
    try {
      const trio = this.providers.makeProviders();
      const start = Date.now();
      const { text, model } = await trio.translation.translate({
        text: req.text,
        sourceLanguage: req.source,
        targetLanguage: req.target,
        models: req.models,
        hints: req.hints,
        context: req.context,
        onChunk: req.onChunk,
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
   * `translate`, fanned out over every target — the shape a turn's FINAL
   * translation always takes, whether that turn has one target or several.
   *
   * `Promise.all`, not a sequential loop: each target is an independent
   * request against (today) the same model ladder, and a turn with several
   * targets must not wait on them one at a time. One target costs exactly what
   * a single `translate` call always cost.
   */
  async translateAll(req: {
    text: string;
    source: LanguageCode;
    targets: readonly LanguageCode[];
    models?: string[];
    hints?: TranslationHints;
    context?: string[];
  }): Promise<TranslationMap> {
    const entries = await Promise.all(
      req.targets.map(
        async (target) =>
          [
            target,
            await this.translate({
              text: req.text,
              source: req.source,
              target,
              models: req.models,
              hints: req.hints,
              context: req.context,
            }),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
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
    plan: TurnLanguagePlan,
  ): Promise<TranslatedTurnText> {
    try {
      const sourceText = await this.transcribe({
        ...input,
        language: plan.recognition,
      });
      if (!sourceText.trim()) {
        // Logged, not merely thrown, because how often this fires is itself the
        // open question. Two production recordings each lost one utterance and
        // this was the leading suspect — until the same audio was decoded twelve
        // ways through the live sidecar and came back non-empty every time. If
        // that holds, this branch is rare and the losses are elsewhere; if it
        // does not, this line is what will say so. Bytes rather than a duration:
        // decoding happened inside the provider and the length is not back here.
        this.logger.warn(
          `No speech detected: ${plan.recognition} ${input.audio.byteLength}B ${input.mimeType}`,
        );
        throw new BadRequestException('No speech detected in the audio');
      }

      // Each target logs its own model and timing inside `translate`; nothing
      // further to add here.
      const translations = await this.translateAll({
        text: sourceText,
        source: plan.recognition,
        targets: plan.targets,
        models: input.models,
        hints: input.hints,
        context: input.context,
      });

      return { sourceText, translations };
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
  async listVoices(language: LanguageCode): Promise<TtsVoiceCatalog> {
    const cached = this.voiceCache.get(language);
    if (cached && Date.now() < cached.expiresAt) return cached;

    const trio = this.providers.makeProviders();
    if (!trio.tts.listVoices) return { voices: [], speedAdjustable: false };

    const catalog = await trio.tts.listVoices(language);
    this.voiceCache.set(language, {
      ...catalog,
      expiresAt: Date.now() + VOICE_CACHE_TTL_MS,
    });
    return catalog;
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizedSpeech> {
    try {
      const trio = this.providers.makeProviders();

      const ttsStart = Date.now();
      const bytes = await trio.tts.synthesize(ttsRequestFor(trio.tts, req));
      this.logger.log(`tts(${trio.tts.name}) ${Date.now() - ttsStart}ms`);

      // The provider that synthesized the audio owns its container format.
      return { bytes, mimeType: trio.tts.outputMimeType };
    } catch (err) {
      return this.handlePipelineError(err);
    }
  }

  /**
   * The same synthesis as `synthesize`, delivered as the backend produces it —
   * or `null` when this backend cannot stream, and the caller should fall back
   * to `synthesize` clause by clause.
   *
   * Resolves at first audio, which is what the log line times. The same voice
   * gate applies: a token reaches only a provider that could have published it.
   *
   * `ProviderAbortedError` passes through unmapped. It means `signal` fired —
   * the listener left — and that is not a provider fault to report as one.
   * Failures while the stream is being read are the caller's to map, through
   * `failSynthesis`, so a turn that breaks part-way reads exactly like one that
   * broke before its first byte.
   */
  async synthesizeStream(
    req: SynthesizeRequest,
    signal: AbortSignal,
  ): Promise<TtsAudioStream | null> {
    try {
      const trio = this.providers.makeProviders();
      if (!trio.tts.synthesizeStream) return null;

      const ttsStart = Date.now();
      const stream = await trio.tts.synthesizeStream(
        ttsRequestFor(trio.tts, req),
        signal,
      );
      if (stream) {
        this.logger.log(
          `tts-stream(${trio.tts.name}) first-audio ${Date.now() - ttsStart}ms`,
        );
      }
      return stream;
    } catch (err) {
      if (err instanceof ProviderAbortedError) throw err;
      return this.handlePipelineError(err);
    }
  }

  /** Map a provider fault met while READING a speech stream, as above. */
  failSynthesis(err: unknown): never {
    return this.handlePipelineError(err);
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
    if (err instanceof ProviderBusyError) {
      this.logger.warn(`Speech engine busy: ${err.message}`);
      throw new SpeechEngineBusyException();
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

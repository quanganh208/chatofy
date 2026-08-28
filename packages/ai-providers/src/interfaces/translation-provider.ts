// TranslationProvider contract — text-to-text translation (e.g. GPT-4o, DeepL)
import type { LanguageCode, ProviderConfig } from './provider-types.js';

export interface TranslationProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

/**
 * Register the translation should be written in.
 *
 * A closed enum, not free text, and that is a security decision rather than a
 * modelling one. Topic and hotwords reach the prompt as data inside a fenced
 * block; a free-text style would be the one hint whose whole purpose is to
 * change how the model writes, which is indistinguishable from an instruction.
 */
export type TranslationStyle = 'neutral' | 'formal' | 'casual';

/**
 * What the translator is told about the conversation before it sees a word of it.
 *
 * Every field is optional and the whole object is optional. A request with no
 * hints produces a prompt byte-identical to the one without this feature, which
 * is what lets the recorded prompt-injection baseline keep describing the
 * default path.
 */
export interface TranslationHints {
  /**
   * What the conversation is about, in a few words — "hotel check-in",
   * "cardiology consultation".
   *
   * Resolves the homophones a recognizer cannot: which of several same-sounding
   * words was meant is a question about the subject matter, not the audio.
   */
  topic?: string;
  /**
   * Names, jargon, and product terms likely to appear.
   *
   * These are deliberately NOT filtered against the transcript before being
   * sent. A hotword earns its place precisely when the recognizer got the word
   * wrong, so matching the list against the recognizer's output would drop
   * exactly the entries that were about to do the work.
   */
  hotwords?: string[];
  /** Register for the output. Omitted means the model chooses, as it does today. */
  style?: TranslationStyle;
}

export interface TranslationRequest {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  /** Optional preceding utterances for context-aware translation. */
  context?: string[];
  /**
   * Conversation-level guidance carried into the prompt as fenced data.
   *
   * Providers that cannot use it ignore it; none may pass it through as
   * instruction.
   */
  hints?: TranslationHints;
  /**
   * Models to try for this request, in order, overriding whatever the provider
   * was configured with. Providers that address only one model ignore it.
   *
   * Exists because callers differ in what they can tolerate. A conversational
   * turn cannot use a model that takes eighteen seconds, however correct its
   * answer; a batch caller would rather wait than fail. Leaving the ladder
   * purely provider-level forces one policy on both, and measurement showed
   * what that costs: speculative traffic pushed the fast model past its
   * per-minute ceiling, the shared ladder walked down to the slow one, and two
   * live turns took ten and eighteen seconds.
   */
  models?: string[];
}

export interface TranslationResult {
  text: string;
  /** Populated if the provider auto-detected the source language. */
  detectedSource?: LanguageCode;
  /**
   * The model that actually produced the text. Providers that can switch model
   * mid-request (e.g. on a quota rejection) report it so callers log the model
   * that ran rather than the one that was selected.
   */
  model?: string;
}

/**
 * A machine transcript to be rewritten in its OWN language for a reader.
 *
 * Deliberately not a `TranslationRequest` with equal source and target. The two
 * differ in the only field that matters — a translation may choose any wording
 * that preserves meaning, while this may change no word at all — and collapsing
 * them would mean one instruction serving both, which is exactly the shared
 * prompt the translator's recorded injection baseline describes.
 */
export interface TranscriptRepairRequest {
  text: string;
  /** The language the transcript is already in; the output stays in it. */
  language: LanguageCode;
  /**
   * Models to try in order, overriding the provider's configuration.
   *
   * A repair has the opposite latency profile from a live turn: nobody is
   * waiting on it, so it belongs on the slow reserve model whose quota the
   * conversation cannot spend anyway.
   */
  models?: string[];
}

export interface TranscriptRepairResult {
  text: string;
  /** The model that answered, for the same reason {@link TranslationResult} reports one. */
  model?: string;
}

export interface TranslationProvider {
  readonly name: string;
  translate(req: TranslationRequest): Promise<TranslationResult>;
  /**
   * Rewrite a machine transcript in its own language: punctuation, casing and
   * numerals restored, no word changed.
   *
   * Optional, because it is a display convenience rather than part of being a
   * translator — a provider without it costs a caller the polish and nothing
   * else. Callers must treat its absence and its failure identically, since the
   * fallback for both is showing the raw transcript.
   */
  repair?(req: TranscriptRepairRequest): Promise<TranscriptRepairResult>;
}

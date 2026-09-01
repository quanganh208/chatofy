// TranslationProvider contract — text-to-text translation (e.g. GPT-4o, DeepL)
import type { GlossaryTerm } from '@chatofy/types';
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
  /**
   * Domain glossary for the session, injected as preferred renderings.
   *
   * Each entry is a language-symmetric pair; the prompt builder picks the source
   * side as the trigger and the target side as the rendering from the request's
   * languages. Unlike `hotwords` — a spelling to EXPECT — these carry a preferred
   * TRANSLATION. An ordinary pair is prompt-bias only, so it can never put a term
   * into a sentence that did not contain it; a `keepVerbatim` entry is
   * additionally enforced after the model returns.
   *
   * Server-supplied from the authenticated user's saved glossary and never
   * accepted from the client hint path, so it cannot be used to inject arbitrary
   * mappings the way an open free-text field could.
   */
  terms?: readonly GlossaryTerm[];
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

export interface TranslationProvider {
  readonly name: string;
  translate(req: TranslationRequest): Promise<TranslationResult>;
}

// TranslationProvider contract — text-to-text translation (e.g. GPT-4o, DeepL)
import type { LanguageCode, ProviderConfig } from './provider-types.js';

export interface TranslationProviderConfig extends ProviderConfig {
  apiKey?: string;
  model?: string;
}

export interface TranslationRequest {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  /** Optional preceding utterances for context-aware translation. */
  context?: string[];
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

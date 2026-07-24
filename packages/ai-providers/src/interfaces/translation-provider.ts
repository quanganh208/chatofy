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

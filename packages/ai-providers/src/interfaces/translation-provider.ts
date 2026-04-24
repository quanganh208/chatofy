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
}

export interface TranslationProvider {
  readonly name: string;
  translate(req: TranslationRequest): Promise<TranslationResult>;
}

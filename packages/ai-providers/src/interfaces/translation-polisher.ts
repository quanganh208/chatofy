import type { LanguageCode } from './provider-types.js';

/**
 * One finished turn's translation, offered back for a second, stronger pass.
 *
 * The draft has already been shown and spoken, so the pass is an edit of it
 * rather than a fresh translation: keeping what was right keeps the terms the
 * listener already heard.
 */
export interface TranslationPolishRequest {
  /** The recognizer's transcript of the turn: untrusted, and possibly misheard. */
  source: string;
  /** The translation already delivered for it. */
  draft: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  /** Earlier finished source turns, oldest first, as data. */
  context?: string[];
}

export interface TranslationPolisher {
  readonly name: string;
  /**
   * The corrected translation, or `null` when the draft stands — unchanged, or
   * an answer this pass will not trust. A thrown error means the host failed.
   */
  polish(req: TranslationPolishRequest): Promise<string | null>;
}

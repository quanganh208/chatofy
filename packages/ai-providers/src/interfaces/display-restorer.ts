import type { LanguageCode } from './provider-types.js';

/** What a restore is asked to read beside the transcript itself. */
export interface DisplayRestoreOptions {
  language: LanguageCode;
  /**
   * The piece this transcript continues, when the client's length ceiling cut
   * it mid-sentence. Read for the seam, never returned.
   */
  context?: string;
  /** The session's hotwords; a restorer may use the mixed-case ones as forms. */
  terms?: string[];
  /**
   * Silence after each word of the transcript in ms, as the recognizer
   * measured it. A full stop where the speaker never paused is dropped.
   */
  pauses?: number[];
}

/**
 * Punctuation and case for a transcript the recognizer left bare, for DISPLAY.
 *
 * A tagger, not a writer: an implementation may change marks and case and
 * nothing else, which is what lets its output sit where the speaker's words
 * belong without a prompt-injection surface. The raw transcript stays the
 * canonical text everywhere else.
 */
export interface DisplayRestorer {
  readonly name: string;
  restore(text: string, options: DisplayRestoreOptions): Promise<string>;
}

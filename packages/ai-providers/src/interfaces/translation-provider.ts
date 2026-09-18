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
 * One dictionary entry: a term in each language.
 *
 * Keyed by LANGUAGE rather than by role, because one stored dictionary serves
 * BOTH directions of a bidirectional meeting — the extension runs two sessions
 * with opposite directions off one settings object. Which side is the source is
 * therefore a property of the request, not of the entry, and
 * `buildContextBlock` resolves it against `TranslationRequest.sourceLanguage`.
 */
export interface GlossaryEntry {
  vi: string;
  en: string;
}

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
  /**
   * Preferred renderings for particular terms, as language-keyed pairs.
   *
   * What this must NOT be read as: a pair is a rendering the model may CHOOSE
   * when the transcript actually contains the term on the source side. It is not
   * a substitution the provider performs on the text, and it is not a licence to
   * put either side into a sentence that did not contain it. A correct
   * translation with a glossary target bolted onto it is the failure this field
   * is most likely to produce, and the injection corpus grades for it by name.
   *
   * Like `hotwords`, entries are NOT filtered against the transcript before
   * being sent: a rendering earns its place precisely when the model would
   * otherwise choose a different one.
   */
  glossary?: GlossaryEntry[];
  /** Register for the output. Omitted means the model chooses, as it does today. */
  style?: TranslationStyle;
}

export interface TranslationRequest {
  text: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  /**
   * Source utterances that already FINISHED earlier in this conversation,
   * oldest first, for translating one that starts mid-sentence.
   *
   * A speaker who hesitates produces two- and three-word turns — "Tôi đề ra",
   * "Thì nó" — and each one reaches the model alone, with no way to tell what
   * sentence it belongs to. These are that sentence.
   *
   * FINISHED is the load-bearing word and it is not a synonym for "preceding".
   * Several turns are in flight at once, so the turn immediately before this one
   * may still be being translated; this list is whatever has actually completed,
   * never a placeholder and never something to wait for. A caller that blocked
   * to fill it would have turned a context feature into a latency feature.
   *
   * Untrusted on exactly the terms the transcript is — it IS a transcript — and
   * a provider that uses it must contain it the same way. Bounding it is the
   * provider's job, not the caller's: the caller cannot know what a prompt
   * costs.
   */
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
  /**
   * Called with each piece of translated text as it arrives, for a caller that
   * can show a translation while it is still being written.
   *
   * Optional on the request rather than a second parameter, so a provider that
   * cannot stream simply never calls it and no implementation has to change.
   *
   * `restart` is not decoration. A provider may abandon one attempt and try
   * another key or model, and the text already handed over belongs to the
   * attempt that failed. The first call of every attempt sets it, and a caller
   * that appends blindly will splice two different translations together.
   *
   * The final result still returns in full. This is an addition to it, never a
   * replacement for it — a caller may ignore it entirely and lose nothing.
   */
  onChunk?: (delta: string, restart: boolean) => void;
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

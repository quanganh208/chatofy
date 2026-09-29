import {
  conversationLanguagesOf,
  translationTargets,
  type LanguageCode,
  type TranslationDirection,
} from '@chatofy/types';
import type { LanguageIdentifier } from './language-identifier';

/**
 * A value per target language, for whatever the pipeline produced against
 * that target — a translation, a rendered clause, and so on. Any subset of
 * the conversation's languages may be present, mirroring the wire shape
 * `@chatofy/types` already defines for a stored segment
 * (`translationMapSchema`).
 */
export type TranslationMap = Partial<Record<LanguageCode, string>>;

/**
 * What one turn is decided to do, language-wise, before a single frame of its
 * audio is transcribed.
 *
 * Built once per turn from the conversation's declared languages and whatever
 * `LanguageIdentifier` reports the turn was actually spoken in — see
 * `planTurnLanguages`. Everything downstream (recognition, the translation
 * fan-out, which target is spoken aloud) reads this rather than re-deriving
 * from `direction`, so a turn that one day mixes languages changes in exactly
 * one place.
 */
export interface TurnLanguagePlan {
  /** Every language the conversation is held in, in the order it declared them. */
  readonly conversation: readonly LanguageCode[];
  /** What the turn was spoken in, per `LanguageIdentifier` — length 1 today. */
  readonly sourceLanguages: readonly LanguageCode[];
  /** Every language this turn must be translated into. */
  readonly targets: readonly LanguageCode[];
  /**
   * The language this turn's audio is RECOGNISED in.
   *
   * The first of `sourceLanguages`, because today's STT is one engine per
   * language and cannot read a mixed-language utterance in one pass — a mixed
   * turn is recognised as if it were spoken entirely in its first language
   * until a multi-language recognizer exists (see the deferred seam in
   * `docs/system-architecture.md`).
   */
  readonly recognition: LanguageCode;
  /**
   * The language this turn's translation is SPOKEN in.
   *
   * The first of `targets`, in the conversation's own order — only one of the
   * fan-out's results is ever synthesized; TTS for every target at once is
   * not supported (see `docs/system-architecture.md`).
   */
  readonly spoken: LanguageCode;
}

/**
 * Decide a turn's language plan.
 *
 * `sourceLanguages` must already be non-empty — every `LanguageIdentifier`
 * returns at least one code, `DeclaredLanguageIdentifier` being the trivial
 * case — and `conversation` must hold every code any source or target could
 * name, which `conversationLanguagesOf` already guarantees for today's two-
 * language conversations.
 */
export function planTurnLanguages(
  conversation: readonly LanguageCode[],
  sourceLanguages: readonly LanguageCode[],
): TurnLanguagePlan {
  const targets = translationTargets(conversation, sourceLanguages);
  return {
    conversation,
    sourceLanguages,
    targets,
    // Non-null by the contract above: a `LanguageIdentifier` never returns an
    // empty array.
    recognition: sourceLanguages[0]!,
    // Non-null because `targets` keeps `conversation`'s order and `conversation`
    // holds at least two distinct languages while `sourceLanguages` is a
    // non-empty subset of it — `translationTargets` cannot empty it out.
    spoken: targets[0]!,
  };
}

/**
 * Decide a turn's language plan from the direction the client declared.
 *
 * The ONE place a transport turns a direction into a plan: the WS path calls
 * it once per turn in `TranslationSessionService.start` (and hands the result
 * to `TurnSession`), the REST path once per request. Keeping the derivation
 * here is what keeps the refusal check and the turn that actually runs reading
 * the same plan once an identifier is no longer a pure function of the
 * declared language.
 */
export function planForDirection(
  direction: TranslationDirection,
  identifier: LanguageIdentifier,
): TurnLanguagePlan {
  const conversation = conversationLanguagesOf(direction);
  return planTurnLanguages(
    conversation,
    identifier.identify({ declared: conversation[0] }),
  );
}

import {
  detectConversationLanguages,
  pairLanguages,
  translationTargets,
  type LanguageCode,
  type LanguagePair,
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
 * from the language pair, so a turn that one day mixes languages changes in exactly
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
   *
   * Null when `targets` is empty: a detect turn heard in the language it would
   * be translated into is shown as transcript and neither translated nor spoken.
   */
  readonly spoken: LanguageCode | null;
}

/** A plan from a declared pair, which always has a language to speak. */
export interface DeclaredTurnLanguagePlan extends TurnLanguagePlan {
  readonly spoken: LanguageCode;
}

/**
 * Decide a turn's language plan.
 *
 * `sourceLanguages` must already be non-empty — every `LanguageIdentifier`
 * returns at least one code, `DeclaredLanguageIdentifier` being the trivial
 * case — and `conversation` must hold every code any source or target could
 * name, which `pairLanguages` already guarantees for today's two-
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
    spoken: targets[0] ?? null,
  };
}

/**
 * The plan of one turn of a detect session, once the turn's language is known.
 *
 * The conversation is {@link detectConversationLanguages}, the same array the
 * client saves, so the speaker role decided here is the one the save checks.
 * The one target is the session's own: a turn heard in it has nothing to be
 * translated into, and is transcript only.
 */
export function planDetectTurn(
  target: LanguageCode,
  heard: LanguageCode,
): TurnLanguagePlan {
  const targets = heard === target ? [] : [target];
  return {
    conversation: detectConversationLanguages(target),
    sourceLanguages: [heard],
    targets,
    recognition: heard,
    spoken: targets[0] ?? null,
  };
}

/**
 * Decide a turn's language plan from the language pair the client declared.
 *
 * The ONE place a transport turns a language pair into a plan: the WS path calls
 * it once per turn in `TranslationSessionService.start` (and hands the result
 * to `TurnSession`), the REST path once per request. Keeping the derivation
 * here is what keeps the refusal check and the turn that actually runs reading
 * the same plan once an identifier is no longer a pure function of the
 * declared language.
 */
export function planForPair(
  pair: LanguagePair,
  identifier: LanguageIdentifier,
): DeclaredTurnLanguagePlan {
  const conversation = pairLanguages(pair);
  const plan = planTurnLanguages(
    conversation,
    identifier.identify({ declared: conversation[0] }),
  );
  const { spoken } = plan;
  // A pair holds two distinct languages and the identifier answers a non-empty
  // subset of them, so `translationTargets` cannot empty the targets out.
  if (spoken === null) {
    throw new Error(
      `A declared pair planned no target: ${pair.source}→${pair.target}`,
    );
  }
  return { ...plan, spoken };
}

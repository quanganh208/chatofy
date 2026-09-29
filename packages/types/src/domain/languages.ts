// The language registry — the ONE place in the monorepo that knows which
// languages exist. Every language code, every direction, and every rule that maps
// between them derives from `LANGUAGES`; nothing else may spell 'vi' or 'en' as a
// branch condition or write a direction literal.
//
// DATA plus PURE FUNCTIONS, deliberately not a class per language. A direction
// travels as the string `${source}_to_${target}` across the socket, Postgres,
// localStorage and React state; a class instance would break `===` and every
// serializer on that path. Polymorphism lives where behaviour actually differs,
// behind `LanguageTable<T>` strategy tables and provider interfaces, not here.
//
// This module is a leaf: it depends only on zod and the speaker-role enum, so any
// package that already takes `@chatofy/types` can read it.
import { z } from 'zod';
import type { SpeakerRole } from './session.js';

/** What the registry records about one language. */
interface LanguageSpec {
  /** The name English-language prompts use ("translate into Vietnamese"). */
  readonly englishName: string;
  /**
   * The language's name for itself.
   *
   * Lives here rather than in the i18n catalogues because an endonym does not
   * depend on the interface locale: the direction toggle reads "Tiếng Việt" in
   * both locales. Names that DO follow the locale ("Vietnamese" / "Tiếng Việt" on
   * a history row) stay in i18n under `web.languageName.<code>`.
   */
  readonly nativeName: string;
}

/**
 * Every supported language, in REGISTRY ORDER. The order is load-bearing: it
 * fixes the order of generated directions and decides which side of a
 * conversation is `speaker_a` (see `speakerRoleFor`).
 */
export const LANGUAGES = {
  vi: { englishName: 'Vietnamese', nativeName: 'Tiếng Việt' },
  en: { englishName: 'English', nativeName: 'English' },
} as const satisfies Record<string, LanguageSpec>;

export type LanguageCode = keyof typeof LANGUAGES;

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as [LanguageCode, ...LanguageCode[]];

export const languageCodeSchema = z.enum(LANGUAGE_CODES);

/**
 * A value for EVERY language, with no fallback. Adding a language to the
 * registry makes each table a type error until it has an entry, which is how the
 * compiler lists the work a new language needs.
 */
export type LanguageTable<T> = Readonly<Record<LanguageCode, T>>;

/** Every ordered pair of distinct languages from `L`, as a direction string. */
export type Direction<L extends string> = {
  [S in L]: { [T in Exclude<L, S>]: `${S}_to_${T}` }[Exclude<L, S>];
}[L];

type SourceOf<D extends string> = D extends `${infer S}_to_${string}` ? S : never;
type TargetOf<D extends string> = D extends `${string}_to_${infer T}` ? T : never;
type Reversed<D extends string> = D extends `${infer S}_to_${infer T}` ? `${T}_to_${S}` : never;

// Generic over `L` so the specs can exercise a third language without adding it
// to the registry.
export function directionOf<L extends string>(source: L, target: L): Direction<L> {
  return `${source}_to_${target}` as Direction<L>;
}

/** Every direction between `codes`, source-major in the order given. */
export function allDirections<L extends string>(codes: readonly L[]): Direction<L>[] {
  return codes.flatMap((source) =>
    codes.filter((target) => target !== source).map((target) => directionOf(source, target)),
  );
}

const DIRECTION_SEPARATOR = '_to_';

export function directionLanguages<D extends string>(
  direction: D,
): { source: SourceOf<D>; target: TargetOf<D> } {
  const at = direction.indexOf(DIRECTION_SEPARATOR);
  return {
    source: direction.slice(0, at) as SourceOf<D>,
    target: direction.slice(at + DIRECTION_SEPARATOR.length) as TargetOf<D>,
  };
}

export function reverseDirection<D extends string>(direction: D): Reversed<D> {
  const { source, target } = directionLanguages(direction);
  return `${target}${DIRECTION_SEPARATOR}${source}` as Reversed<D>;
}

export type TranslationDirection = Direction<LanguageCode>;

export const TRANSLATION_DIRECTIONS = allDirections(LANGUAGE_CODES) as [
  TranslationDirection,
  ...TranslationDirection[],
];

export const translationDirectionSchema = z.enum(TRANSLATION_DIRECTIONS);

/** Applied wherever a caller may leave the direction unstated. */
export const DEFAULT_TRANSLATION_DIRECTION: TranslationDirection = directionOf('vi', 'en');

/**
 * The languages a conversation declared by `direction` is held in, declared
 * source first — so the direction can be derived back from the set exactly.
 */
export function conversationLanguagesOf(
  direction: TranslationDirection,
): [LanguageCode, LanguageCode] {
  const { source, target } = directionLanguages(direction);
  return [source, target];
}

/**
 * The languages a turn should be translated INTO.
 *
 * A single-language turn goes to every other language of the conversation. A
 * mixed turn (several sources) goes to the whole conversation set, because each
 * listener needs the whole turn in their own language — including the parts said
 * in another one. Keeps the conversation's order.
 */
export function translationTargets<L extends string>(
  conversation: readonly L[],
  sources: readonly L[],
): L[] {
  const [only, ...rest] = sources;
  if (only === undefined || rest.length > 0) return [...conversation];
  return conversation.filter((language) => language !== only);
}

/**
 * The binary speaker role of a turn said in `source`.
 *
 * The conversation's registry-first language is `speaker_a`, whatever order the
 * conversation declared its languages in. That keeps the invariant every stored
 * row already has — `speaker_a` is the Vietnamese side — for both directions.
 */
export function speakerRoleFor(
  source: LanguageCode,
  conversation: readonly LanguageCode[],
): SpeakerRole {
  const first = LANGUAGE_CODES.find((code) => conversation.includes(code));
  return source === first ? 'speaker_a' : 'speaker_b';
}

/**
 * The registry language a BCP-47 tag names, by its primary subtag
 * ("vi-VN" → "vi"), or null when the registry has no such language. Only ever
 * returns a registry code, so a tag reported by a model cannot reach a prompt as
 * an unknown language.
 */
export function toLanguageCode(tag: string): LanguageCode | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return Object.hasOwn(LANGUAGES, primary) ? (primary as LanguageCode) : null;
}

const distinct = (codes: readonly string[]) => new Set(codes).size === codes.length;

/** The languages of a conversation: at least two, no repeats, declared first. */
export const conversationLanguagesSchema = z
  .array(languageCodeSchema)
  .min(2)
  .refine(distinct, 'languages must not repeat');

/** The languages one turn was spoken in: at least one, no repeats. */
export const sourceLanguagesSchema = z
  .array(languageCodeSchema)
  .min(1)
  .refine(distinct, 'languages must not repeat');

/** A value per target language; any subset of the registry may be present. */
export function translationMapSchema<T extends z.ZodType>(valueSchema: T) {
  return z.partialRecord(languageCodeSchema, valueSchema);
}

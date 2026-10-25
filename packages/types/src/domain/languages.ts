// The language registry — the ONE place in the monorepo that knows which
// languages exist. Every language code, every language pair, and every rule that
// maps between them derives from `LANGUAGES`; nothing else may spell 'vi' or 'en'
// as a branch condition.
//
// DATA plus PURE FUNCTIONS, deliberately not a class per language. A language
// pair travels as a plain `{ source, target }` object across the socket,
// localStorage and React state; a class instance would not survive a serializer
// on that path. Polymorphism lives where behaviour actually differs, behind
// `LanguageTable<T>` strategy tables and provider interfaces, not here.
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
   * The name an English interface shows: "Chinese", where the prompt name says
   * "Simplified Chinese" because the model has to be told the script.
   *
   * Here rather than in the i18n catalogues because the extension popup has no
   * catalogue and names languages in English. Web names them in the reader's
   * locale instead, from `web.languageName.<code>`.
   */
  readonly label: string;
}

/**
 * Every supported language, in REGISTRY ORDER. The order is load-bearing: it
 * fixes the order of generated language pairs and decides which side of a
 * conversation is `speaker_a` (see `speakerRoleFor`).
 */
export const LANGUAGES = {
  vi: { englishName: 'Vietnamese', label: 'Vietnamese' },
  en: { englishName: 'English', label: 'English' },
  zh: { englishName: 'Simplified Chinese', label: 'Chinese' },
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

/**
 * The two languages a conversation is declared in: the one the speaker is
 * expected to use, and the one its turns are translated into.
 *
 * An object rather than a `${source}_to_${target}` string so that a later
 * `source` can widen to "detect it" without a second wire format. The price is
 * identity: two equal pairs are never `===`, so every comparison goes through
 * `samePair`, and a pair used as an effect dependency has to come from state.
 */
export interface LanguagePair<L extends string = LanguageCode> {
  readonly source: L;
  readonly target: L;
}

/** Generic over `L` so the specs can exercise a third language without adding it to the registry. */
export function languagePairOf<L extends string>(source: L, target: L): LanguagePair<L> {
  return { source, target };
}

/** Every pair of distinct languages from `codes`, source-major in the order given. */
export function allLanguagePairs<L extends string>(codes: readonly L[]): LanguagePair<L>[] {
  return codes.flatMap((source) =>
    codes.filter((target) => target !== source).map((target) => languagePairOf(source, target)),
  );
}

export function reversePair<L extends string>(pair: LanguagePair<L>): LanguagePair<L> {
  return languagePairOf(pair.target, pair.source);
}

export function samePair<L extends string>(a: LanguagePair<L>, b: LanguagePair<L>): boolean {
  return a.source === b.source && a.target === b.target;
}

export const languagePairSchema = z
  .object({ source: languageCodeSchema, target: languageCodeSchema })
  .refine((pair) => pair.source !== pair.target, 'source and target must differ');

/** Applied wherever a caller may leave the pair unstated. */
export const DEFAULT_LANGUAGE_PAIR: LanguagePair = languagePairOf('vi', 'en');

/**
 * The source a streaming session sends when the speaker's language is not
 * declared: each turn is identified, then translated into the fixed target.
 */
export const AUTO_DETECT = 'detect';

/**
 * A language pair as a streaming session may declare it: either side named, or
 * the source left to be identified per turn.
 *
 * Separate from {@link LanguagePair} rather than a widening of it, because only
 * the WebSocket session path can serve an undeclared source. REST, live and
 * every stored record keep the two-codes pair, so none of them has to narrow a
 * value that can never reach them.
 */
export interface SessionLanguagePair {
  readonly source: LanguageCode | typeof AUTO_DETECT;
  readonly target: LanguageCode;
}

export const sessionLanguagePairSchema = z
  .object({
    source: z.union([languageCodeSchema, z.literal(AUTO_DETECT)]),
    target: languageCodeSchema,
  })
  .refine((pair) => pair.source !== pair.target, 'source and target must differ');

/**
 * The languages a turn can be told apart in, by the identification the product
 * ships. A pair with a language outside this set stays declared one-way: its
 * turns are recognised in the declared source, never guessed at.
 *
 * Chinese is absent because it missed the accuracy bar the vi↔en pair met, on
 * the same labelled set, not because the registry lacks it.
 */
export const IDENTIFIABLE_LANGUAGES: readonly LanguageCode[] = ['vi', 'en'];

/**
 * The languages one turn of this session may turn out to be spoken in.
 *
 * An undeclared source is any identifiable language; a two-way pair is either of
 * its two sides; a declared one-way pair is its source alone, which is what
 * every session was before identification existed.
 */
export function turnCandidates(pair: SessionLanguagePair, twoWay: boolean): LanguageCode[] {
  if (pair.source === AUTO_DETECT) return [...IDENTIFIABLE_LANGUAGES];
  return twoWay ? [pair.source, pair.target] : [pair.source];
}

/**
 * Whether the shipped identification can decide between this session's
 * candidates at all — at least two of them, every one identifiable. Says
 * nothing about whether the running engine has identification switched on;
 * that is the server's to know.
 */
export function canIdentify(pair: SessionLanguagePair, twoWay: boolean): boolean {
  const candidates = turnCandidates(pair, twoWay);
  return (
    candidates.length >= 2 &&
    candidates.every((language) => IDENTIFIABLE_LANGUAGES.includes(language))
  );
}

/**
 * The stored languages of a conversation whose source was identified per turn:
 * the target first, then every other registry language in registry order.
 *
 * Target first, where a declared conversation stores its source first, because
 * there is no declared source to lead with. More than two entries is what marks
 * the conversation as auto-detected (see {@link isAutoDetectConversation}), so
 * no extra stored field is needed to tell the two apart.
 */
export function detectConversationLanguages(target: LanguageCode): LanguageCode[] {
  return [target, ...LANGUAGE_CODES.filter((code) => code !== target)];
}

/** Whether stored conversation languages came from an auto-detected session. */
export function isAutoDetectConversation(languages: readonly LanguageCode[]): boolean {
  return languages.length > 2;
}

/**
 * The languages a conversation declared by `pair` is held in, declared source
 * first — the shape `Conversation.languages` stores.
 */
export function pairLanguages(pair: LanguagePair): [LanguageCode, LanguageCode] {
  return [pair.source, pair.target];
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
 * row already has — `speaker_a` is the Vietnamese side of any conversation with
 * Vietnamese in it — whichever side is declared the source. Without Vietnamese (en↔zh), English is
 * registry-first and so `speaker_a`.
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

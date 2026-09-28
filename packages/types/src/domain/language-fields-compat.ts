// Backward/forward compatibility for the language-keyed conversation fields.
//
// `Conversation.direction` and `ConversationTurn.targetText` were the whole
// contract before this file existed; `Conversation.languages` and
// `ConversationTurn.sourceLanguages`/`translations` replace them at the
// database, but the wire fields are KEPT (see `domain/conversation.ts`) because
// `apps/api` and its callers do not deploy atomically. Three directions of
// staleness follow from that, and each function here owns exactly one:
//
//   - a SAVE REQUEST from a browser tab that predates `languages` carries only
//     `direction`/turn `targetText` — `fillConversationLanguages` and
//     `fillTurnLanguages` fill the new fields in, so the server's strict save
//     schema can validate one shape regardless of which the client sent.
//   - a RESPONSE from an API build rolled back to before this migration is the
//     same gap read by a client instead of a server — the identical two
//     functions fill it there too (see `http/conversations.ts`'s response wire
//     schemas).
//   - deriving the OLD field from the NEW one — what a response actually does
//     on the happy path, since the database no longer stores `direction` or
//     `targetText` at all — runs the other way, and is `legacyDirectionOf`
//     here plus `primaryTranslation` in `domain/conversation.ts` (kept there
//     because the history UI reads it too, in a later phase).
//
// This is a compatibility shim, not a permanent second contract: remove it
// together with the legacy `direction`/`targetText` wire fields once no
// deployed API or open client tab can predate the language-keyed ones.
import type { LanguageCode, TranslationDirection } from './languages.js';
import {
  conversationLanguagesOf,
  directionOf,
  speakerRoleFor,
  translationTargets,
} from './languages.js';

/**
 * Fills `languages` on a conversation-shaped object that carries only the
 * legacy `direction`. A no-op whenever `languages` is already present — a
 * build past this migration writes both, and this must never overwrite a
 * value the caller actually sent with one derived from a field it also sent.
 *
 * Operates on `Record<string, unknown>` rather than a typed `Conversation`,
 * because it runs BEFORE validation, inside a `z.preprocess` — the object it
 * is handed may be neither shape yet, which is the whole reason it exists.
 */
export function fillConversationLanguages(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.languages !== undefined) return raw;
  const { direction } = raw;
  if (typeof direction !== 'string') return raw;
  return { ...raw, languages: conversationLanguagesOf(direction as TranslationDirection) };
}

/**
 * Fills `sourceLanguages`/`translations` on a turn-shaped object that carries
 * only the legacy `speakerRole`/`targetText`, mirroring
 * {@link fillConversationLanguages} for one block. A no-op whenever either new
 * field is already present.
 *
 * `languages` is the PARENT conversation's declared-source-first pair — a turn
 * alone never says which side is which, only which slot (`speaker_a`/
 * `speaker_b`) it filled. `speakerRoleFor` fixes that mapping one way
 * (language → role); this runs it backwards by trying each of the
 * conversation's languages until one produces the role the turn actually has.
 * `translationTargets` then gives the single target a legacy turn always had —
 * every OTHER language in the conversation — and `targetText` becomes that
 * target's entry.
 */
export function fillTurnLanguages(
  raw: Record<string, unknown>,
  languages: readonly LanguageCode[],
): Record<string, unknown> {
  if (raw.sourceLanguages !== undefined || raw.translations !== undefined) return raw;
  const { speakerRole, targetText } = raw;
  const source = languages.find((code) => speakerRoleFor(code, languages) === speakerRole);
  if (source === undefined) return raw;
  const targets = translationTargets(languages, [source]);
  return {
    ...raw,
    sourceLanguages: [source],
    translations: Object.fromEntries(targets.map((target) => [target, targetText])),
  };
}

/**
 * The legacy `direction` a conversation's `languages` derives — the read-side
 * mirror of `conversationLanguagesOf`, and the reason `Conversation.direction`
 * can stay in every response even though Postgres no longer has a column for
 * it. `languages` is declared-source-first, so this reconstructs exactly the
 * direction the original save request declared.
 *
 * Throws on fewer than two languages rather than guessing one: the write side
 * (`conversationLanguagesSchema.min(2)`) never stores a row this could happen
 * to, so reaching this means the stored row is corrupt, and a wrong derived
 * direction is a worse failure than a loud one.
 */
export function legacyDirectionOf(languages: readonly LanguageCode[]): TranslationDirection {
  const [source, target] = languages;
  if (source === undefined || target === undefined) {
    throw new Error('a conversation needs at least two languages to derive a direction');
  }
  return directionOf(source, target) as TranslationDirection;
}

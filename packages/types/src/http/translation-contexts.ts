// Stored translation-context HTTP contracts — schema-first.
//
// Imports the socket's own glossary and hint schemas rather than restating
// them: "this schema is what the socket will accept, that one is what the
// prompt will carry, and neither trusts the other" (`ws-events.ts:26-30`)
// describes two DIFFERENT trust boundaries — the socket and the provider
// prompt. HTTP and WS here guard the SAME boundary, a client, so a glossary
// that can be stored but not sent back down the socket would be a silent
// truncation the user has no way to see.
import { z } from 'zod';
import { LANGUAGES } from '../domain/languages.js';
import {
  MAX_GLOSSARY_TERM_WORDS,
  glossaryEntrySchema,
  translationHintsSchema,
} from '../events/ws-events.js';

export const CONTEXT_LIMITS = {
  MAX_NAME_CHARS: 60,
  MAX_TOPIC_CHARS: 200,
  MAX_HOTWORDS: 48,
  MAX_HOTWORD_CHARS: 64,
  MAX_GLOSSARY: 24,
  MAX_GLOSSARY_TERM_CHARS: 64,
  /**
   * Re-exported from the socket schema rather than restated, because it is the
   * number `glossaryEntrySchema` actually enforces and the editor has to show
   * the same refusal the contract will give. See its docblock for the measured
   * reason a character cap was not enough.
   */
  MAX_GLOSSARY_TERM_WORDS,
  /**
   * How many contexts one account may hold. A ceiling rather than none,
   * because this is the first authenticated route in the product whose write
   * creates an UNBOUNDED number of rows — `PUT /conversations/:id` replaces,
   * and `PUT /auth/me` updates one row.
   */
  MAX_CONTEXTS_PER_OWNER: 20,
} as const;

/**
 * PUT body for one saved context.
 *
 * No user id anywhere in this body, for the reason `updateMeRequestSchema`
 * records (`auth.ts:270-277`): "the safest way to guarantee it is absent is to
 * have no field for it." The row is the caller's own, taken from the verified
 * token.
 */
export const saveTranslationContextRequestSchema = z.object({
  name: z.string().min(1).max(CONTEXT_LIMITS.MAX_NAME_CHARS),
  topic: z.string().max(CONTEXT_LIMITS.MAX_TOPIC_CHARS).nullable().default(null),
  hotwords: z
    .array(z.string().min(1).max(CONTEXT_LIMITS.MAX_HOTWORD_CHARS))
    .max(CONTEXT_LIMITS.MAX_HOTWORDS)
    .default([]),
  glossary: z.array(glossaryEntrySchema).max(CONTEXT_LIMITS.MAX_GLOSSARY).default([]),
  style: translationHintsSchema.shape.style.unwrap().nullable().default(null),
});
export type SaveTranslationContextRequest = z.infer<typeof saveTranslationContextRequestSchema>;

export const translationContextSchema = saveTranslationContextRequestSchema.extend({
  /** The client-minted id, echoed. Never a server cuid — see the Prisma model. */
  id: z.uuid(),
  updatedAt: z.string(),
});
export type TranslationContext = z.infer<typeof translationContextSchema>;

export const translationContextListResponseSchema = z.object({
  contexts: z.array(translationContextSchema),
});
export type TranslationContextListResponse = z.infer<typeof translationContextListResponseSchema>;

/** One stored glossary entry with only the language keys this build knows. */
function knownLanguagesOnly(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  return Object.fromEntries(
    Object.entries(entry).filter(([code]) => Object.hasOwn(LANGUAGES, code)),
  );
}

/** A stored context with every unreadable glossary entry left out, or null. */
function readableContext(raw: unknown): TranslationContext | null {
  let candidate = raw;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { glossary?: unknown }).glossary)) {
    const glossary = (raw as { glossary: unknown[] }).glossary
      .map(knownLanguagesOnly)
      .filter((entry) => glossaryEntrySchema.safeParse(entry).success);
    candidate = { ...raw, glossary };
  }
  const parsed = translationContextSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * The saved contexts this build can read, and how many it could not.
 *
 * Entry by entry rather than one parse over the list, because the list outlives
 * the build reading it: a language key this build has never heard of (a glossary
 * entry with a `zh` side, read by a build from before zh) fails
 * `translationMapSchema`, and one failed parse over the whole list used to show
 * NO contexts at all. Now an unknown key is dropped, an entry that is then
 * unreadable is dropped, and only a context that is still unreadable after that
 * is left out — each loss as small as it can be.
 */
export function readTranslationContextList(raw: unknown): {
  contexts: TranslationContext[];
  dropped: number;
} {
  const list = Array.isArray(raw) ? raw : [];
  const contexts = list.map(readableContext).filter((context) => context !== null);
  return { contexts, dropped: list.length - contexts.length };
}

/** `translationContextListResponseSchema`, read with {@link readTranslationContextList}. */
export const readableTranslationContextListSchema = z
  .object({ contexts: z.array(z.unknown()) })
  .transform(({ contexts }) => readTranslationContextList(contexts));

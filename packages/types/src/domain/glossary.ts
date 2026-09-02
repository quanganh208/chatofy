// Glossary domain types — schema-first (zod source, types inferred).
//
// A glossary is a user's saved set of domain term mappings, applied to every
// translation on their authenticated session so specialized vocabulary renders
// consistently. Each entry is a language-symmetric PAIR — a `vi` spelling and an
// `en` spelling of the same term — because a pair holds in both directions:
// whichever language the session translates FROM supplies the trigger, and the
// other supplies the preferred rendering. `keepVerbatim` marks a proper noun (a
// brand or product name) that must appear unchanged rather than be translated at
// all; for those the two spellings are normally the same string.
//
// The shape here is the term itself — the form the prompt builder consumes.
// `glossaryTermRecordSchema` adds the fields storage mints (id, timestamps) —
// the form the API returns to a client. Neither carries `ownerId`: ownership is
// enforced server-side and never leaves it.
import { z } from 'zod';

/**
 * Ceilings on the glossary, shared by the domain shape and the HTTP contracts.
 *
 * The glossary is injected into the prompt on EVERY turn, so its size is a
 * per-turn cost lever exactly like `hotwords`: `MAX_TERMS` bounds how many
 * entries reach the context block, `MAX_TERM_CHARS` bounds each spelling. The
 * list is trimmed at the injection boundary (over-cap entries dropped, not the
 * request rejected) so a large glossary degrades the hint rather than failing
 * the translation.
 */
export const GLOSSARY_LIMITS = {
  MAX_TERMS: 200,
  MAX_TERM_CHARS: 64,
} as const;

/**
 * One term as it means something to the translator: the two spellings and
 * whether it is kept verbatim. This is the shape the prompt builder consumes.
 *
 * `keepVerbatim` defaults false — an ordinary pair is a preferred RENDERING,
 * biased in the prompt and never a hard replacement, so it can never put a term
 * into a sentence that did not contain it. Only a `keepVerbatim` entry is
 * additionally enforced after the model returns.
 */
export const glossaryTermSchema = z.object({
  vi: z.string().trim().min(1).max(GLOSSARY_LIMITS.MAX_TERM_CHARS),
  en: z.string().trim().min(1).max(GLOSSARY_LIMITS.MAX_TERM_CHARS),
  keepVerbatim: z.boolean().default(false),
});
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;

/**
 * A stored, addressable term — the term plus what persistence mints. This is
 * what the API returns; `id` is what the client addresses on update and delete,
 * and the timestamps are ISO-8601 strings (the wire form), never `Date`.
 */
export const glossaryTermRecordSchema = glossaryTermSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GlossaryTermRecord = z.infer<typeof glossaryTermRecordSchema>;

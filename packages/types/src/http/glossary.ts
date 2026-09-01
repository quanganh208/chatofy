// Glossary HTTP contracts — schema-first. The glossary is owner-scoped and
// server-held; these are the requests a client makes to manage it. The stored
// shape it reads back is `glossaryTermRecordSchema`, owned by the domain barrel.
//
// Glossary terms are NEVER accepted on the translation path — only here, on the
// authenticated management endpoints. The translator receives the glossary the
// server loaded for the user, so an unauthenticated socket cannot inject term
// pairs the way it can already pass `hotwords`.
import { z } from 'zod';
import {
  glossaryTermSchema,
  glossaryTermRecordSchema,
  GLOSSARY_LIMITS,
} from '../domain/glossary.js';

/** Create one term. The body IS the term; id and timestamps are minted server-side. */
export const createGlossaryTermRequestSchema = glossaryTermSchema;
export type CreateGlossaryTermRequest = z.infer<typeof createGlossaryTermRequestSchema>;

/**
 * Update one term. Every field is optional so a client can flip `keepVerbatim`
 * without resubmitting both spellings; the empty body is rejected so a no-op
 * write cannot masquerade as a change.
 */
export const updateGlossaryTermRequestSchema = glossaryTermSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'at least one field must be provided',
  });
export type UpdateGlossaryTermRequest = z.infer<typeof updateGlossaryTermRequestSchema>;

/** The list a client reads back, capped the same as the injected glossary. */
export const glossaryListResponseSchema = z.object({
  terms: z.array(glossaryTermRecordSchema).max(GLOSSARY_LIMITS.MAX_TERMS),
});
export type GlossaryListResponse = z.infer<typeof glossaryListResponseSchema>;

/**
 * A bulk import. Rows arrive already parsed into terms — the client owns CSV
 * parsing so the API stays JSON-only and reuses one term schema — and the whole
 * import is capped at the glossary ceiling so one upload cannot blow past the
 * per-turn injection budget the list is bound by.
 *
 * `mode` is explicit rather than defaulted: `replace` deletes the existing
 * glossary, so the client must say which it meant rather than have a destructive
 * default chosen for it.
 */
export const importGlossaryRequestSchema = z.object({
  terms: z.array(glossaryTermSchema).min(1).max(GLOSSARY_LIMITS.MAX_TERMS),
  mode: z.enum(['merge', 'replace']),
});
export type ImportGlossaryRequest = z.infer<typeof importGlossaryRequestSchema>;

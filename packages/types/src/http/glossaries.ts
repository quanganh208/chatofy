// Standalone Glossary HTTP contracts — schema-first.
//
// Distinct from the GlossaryEntry / GlossaryTerm types that live inside
// TranslationContext: those are {vi, en} pairs wired to the AI Context
// library; these are named glossary collections the user builds and manages
// independently, with arbitrary source/target language pairs and notes.
import { z } from 'zod';
import { languageCodeSchema } from '../domain/languages.js';

export const GLOSSARY_LIMITS = {
  MAX_NAME_CHARS: 60,
  MAX_DESCRIPTION_CHARS: 200,
  MAX_GLOSSARIES_PER_OWNER: 20,
  MAX_ITEMS_PER_GLOSSARY: 500,
  MAX_ITEM_ORIGINAL_CHARS: 120,
  MAX_ITEM_TRANSLATION_CHARS: 120,
  MAX_ITEM_NOTES_CHARS: 200,
} as const;

/**
 * PUT body for creating or updating a glossary's metadata.
 *
 * No id in the body — the client mints a UUID and sends it as the path
 * parameter, following the same pattern as TranslationContext.
 */
export const saveGlossaryRequestSchema = z.object({
  name: z.string().min(1).max(GLOSSARY_LIMITS.MAX_NAME_CHARS),
  description: z.string().max(GLOSSARY_LIMITS.MAX_DESCRIPTION_CHARS).nullable().default(null),
  sourceLang: languageCodeSchema,
});
export type SaveGlossaryRequest = z.infer<typeof saveGlossaryRequestSchema>;

/**
 * PATCH body for toggling a glossary's active state or default flag.
 *
 * At most one glossary per owner may be the default; the server clears the
 * previous default when a new one is set.
 */
export const patchGlossaryRequestSchema = z
  .object({
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((body) => body.isActive !== undefined || body.isDefault !== undefined, {
    message: 'At least one of isActive or isDefault is required.',
  });
export type PatchGlossaryRequest = z.infer<typeof patchGlossaryRequestSchema>;

/** One glossary, as the API returns it. */
export const glossarySchema = z.object({
  /** The client-minted UUID, echoed. */
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  sourceLang: languageCodeSchema,
  isActive: z.boolean(),
  isDefault: z.boolean(),
  /** Denormalised count — avoids a second round-trip just to show "N terms". */
  itemCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Glossary = z.infer<typeof glossarySchema>;

export const glossaryListResponseSchema = z.object({
  glossaries: z.array(glossarySchema),
});
export type GlossaryListResponse = z.infer<typeof glossaryListResponseSchema>;

/**
 * POST body for adding one term to a glossary.
 *
 * The client mints a UUID for the item and sends it in the body so the
 * response can echo it back — the same client-id pattern as Glossary itself,
 * but as a body field rather than a path parameter because the item is
 * created in one shot rather than PUT-upserted.
 */
export const saveGlossaryItemRequestSchema = z.object({
  /** Client-minted UUID for idempotent retries. */
  clientId: z.string().uuid(),
  original: z.string().min(1).max(GLOSSARY_LIMITS.MAX_ITEM_ORIGINAL_CHARS),
  translation: z.string().min(1).max(GLOSSARY_LIMITS.MAX_ITEM_TRANSLATION_CHARS),
  targetLang: languageCodeSchema,
  notes: z.string().max(GLOSSARY_LIMITS.MAX_ITEM_NOTES_CHARS).nullable().default(null),
});
export type SaveGlossaryItemRequest = z.infer<typeof saveGlossaryItemRequestSchema>;

/** One term in a glossary, as the API returns it. */
export const glossaryItemSchema = z.object({
  id: z.string().uuid(),
  glossaryId: z.string().uuid(),
  original: z.string(),
  translation: z.string(),
  targetLang: languageCodeSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type GlossaryItem = z.infer<typeof glossaryItemSchema>;

export const glossaryItemListResponseSchema = z.object({
  items: z.array(glossaryItemSchema),
});
export type GlossaryItemListResponse = z.infer<typeof glossaryItemListResponseSchema>;

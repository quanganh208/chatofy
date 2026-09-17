import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  saveTranslationContextRequestSchema,
  translationContextListResponseSchema,
  translationContextSchema,
} from '@chatofy/types';

/**
 * The path parameter, validated as a UUID.
 *
 * Not decoration: the value goes into a btree unique index, and Postgres refuses
 * an index tuple over ~2704 bytes — so an unvalidated multi-kilobyte id is a 500
 * where a 400 belongs. The client mints `crypto.randomUUID()`, so the constraint
 * costs a legitimate caller nothing.
 */
export const translationContextIdParamSchema = z.object({
  contextId: z.uuid(),
});

/** PUT /translation-contexts/:contextId body. */
export class SaveTranslationContextRequestDto extends createZodDto(
  saveTranslationContextRequestSchema,
) {}

/** :contextId, for every route that carries one. */
export class TranslationContextIdParamDto extends createZodDto(
  translationContextIdParamSchema,
) {}

/** Success payloads — used for the OpenAPI envelope schemas. */
/** One saved context, as the PUT echoes it back. */
export class TranslationContextResponseDto extends createZodDto(
  z.object({ context: translationContextSchema }),
) {}
export class TranslationContextListResponseDto extends createZodDto(
  translationContextListResponseSchema,
) {}

import { createZodDto } from 'nestjs-zod';
import {
  createGlossaryTermRequestSchema,
  glossaryListResponseSchema,
  glossaryTermResponseSchema,
  importGlossaryRequestSchema,
  updateGlossaryTermRequestSchema,
} from '@chatofy/types';

/** POST /glossary/terms body (validated by the global ZodValidationPipe). */
export class CreateGlossaryTermRequestDto extends createZodDto(
  createGlossaryTermRequestSchema,
) {}

/** PATCH /glossary/terms/:id body. */
export class UpdateGlossaryTermRequestDto extends createZodDto(
  updateGlossaryTermRequestSchema,
) {}

/** POST /glossary/import body. */
export class ImportGlossaryRequestDto extends createZodDto(
  importGlossaryRequestSchema,
) {}

/** List / import success payload — used for the OpenAPI envelope schema. */
export class GlossaryListResponseDto extends createZodDto(
  glossaryListResponseSchema,
) {}

/** Single-term success payload for create, update, and delete. */
export class GlossaryTermResponseDto extends createZodDto(
  glossaryTermResponseSchema,
) {}

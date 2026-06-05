import { createZodDto } from 'nestjs-zod';
// Root barrel (resolves in tsc, nest build, and ts-jest alike).
import { apiMetaSchema, apiErrorSchema } from '@chatofy/types';

// OpenAPI models for the envelope `meta`/`error` blocks, derived directly from
// the shared response contract in @chatofy/types — no local re-declaration.

/** OpenAPI model for the envelope `meta` block. */
export class ApiMetaDto extends createZodDto(apiMetaSchema) {}

/** OpenAPI model for the error envelope `error` block. */
export class ApiErrorDto extends createZodDto(apiErrorSchema) {}

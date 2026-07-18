import { createZodDto } from 'nestjs-zod';
// Root barrel (resolves in tsc, nest build, and ts-jest alike).
import { apiMetaSchema } from '@chatofy/types';

// OpenAPI model for the envelope `meta` block, derived directly from the
// shared response contract in @chatofy/types — no local re-declaration.

/** OpenAPI model for the envelope `meta` block. */
export class ApiMetaDto extends createZodDto(apiMetaSchema) {}

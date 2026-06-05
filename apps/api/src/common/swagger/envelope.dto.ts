import { createZodDto } from 'nestjs-zod';
// Import from the ROOT barrel — api uses moduleResolution:"node", which ignores
// package `exports` subpaths, so `@chatofy/types/http` would not resolve here.
import { apiMetaSchema, apiErrorSchema } from '@chatofy/types';

// OpenAPI models for the envelope `meta`/`error` blocks, derived directly from
// the shared response contract in @chatofy/types — no local re-declaration.

/** OpenAPI model for the envelope `meta` block. */
export class ApiMetaDto extends createZodDto(apiMetaSchema) {}

/** OpenAPI model for the error envelope `error` block. */
export class ApiErrorDto extends createZodDto(apiErrorSchema) {}

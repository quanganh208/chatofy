import { createZodDto } from 'nestjs-zod';
// Root barrel (resolves in tsc, nest build, and the test runner alike).
import { apiErrorResponseSchema, apiMetaSchema } from '@chatofy/types';

// OpenAPI models for the response envelope, derived directly from the shared
// response contract in @chatofy/types — no local re-declaration.

/** OpenAPI model for the envelope `meta` block. */
export class ApiMetaDto extends createZodDto(apiMetaSchema) {}

/**
 * OpenAPI model for the failure envelope
 * `{ success: false, error: { code, message, details? }, meta }`.
 *
 * Whole-envelope, unlike the success side, which composes `data` per route: the
 * error body is identical on every route and every status, so documenting it
 * once is both the truth and the DRY option. `AllExceptionsFilter` is what
 * emits it.
 */
export class ApiErrorResponseDto extends createZodDto(apiErrorResponseSchema) {}

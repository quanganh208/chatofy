import { createZodDto } from 'nestjs-zod';
import {
  preferencesResponseSchema,
  updatePreferencesRequestSchema,
} from '@chatofy/types';

/**
 * PATCH /me/preferences body (validated by the global ZodValidationPipe).
 *
 * The patch schema is strict, so an unknown top-level field is a 400 rather
 * than silently dropped: a client that thinks it saved something must learn
 * that it did not.
 */
export class UpdatePreferencesRequestDto extends createZodDto(
  updatePreferencesRequestSchema,
) {}

/** Success payload of all three routes — used for the OpenAPI envelope schema. */
export class PreferencesResponseDto extends createZodDto(
  preferencesResponseSchema,
) {}

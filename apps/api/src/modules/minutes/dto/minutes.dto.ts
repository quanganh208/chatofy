import { createZodDto } from 'nestjs-zod';
import {
  generateMinutesRequestSchema,
  minutesResponseSchema,
} from '@chatofy/types';

/** POST /sessions/:id/minutes body (validated by the global ZodValidationPipe). */
export class GenerateMinutesRequestDto extends createZodDto(
  generateMinutesRequestSchema,
) {}

/** Minutes success payload — used for the OpenAPI envelope schema. */
export class MinutesResponseDto extends createZodDto(minutesResponseSchema) {}

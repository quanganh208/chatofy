import { createZodDto } from 'nestjs-zod';
import {
  translateRequestSchema,
  translateResponseSchema,
} from '@chatofy/types';

/** POST /translate request body (validated by the global ZodValidationPipe). */
export class TranslateRequestDto extends createZodDto(translateRequestSchema) {}

/** POST /translate success payload — used for the OpenAPI envelope schema. */
export class TranslateResponseDto extends createZodDto(
  translateResponseSchema,
) {}

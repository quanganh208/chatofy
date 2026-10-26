import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  createConferenceRequestSchema,
  conferenceResponseSchema,
  conferenceDetailResponseSchema,
  conferenceListResponseSchema,
} from '@chatofy/types';

/** POST /conference body. */
export class CreateConferenceRequestDto extends createZodDto(
  createConferenceRequestSchema,
) {}

/** :id path parameter — validated as cuid-length string. */
export const conferenceIdParamSchema = z.object({ id: z.string().min(1) });
export class ConferenceIdParamDto extends createZodDto(
  conferenceIdParamSchema,
) {}

/** Pagination query — ?page and ?limit. */
export const conferenceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export class ConferenceListQueryDto extends createZodDto(
  conferenceListQuerySchema,
) {}

/** Response DTOs for OpenAPI envelope schemas. */
export class ConferenceResponseDto extends createZodDto(
  conferenceResponseSchema,
) {}
export class ConferenceDetailResponseDto extends createZodDto(
  conferenceDetailResponseSchema,
) {}
export class ConferenceListResponseDto extends createZodDto(
  conferenceListResponseSchema,
) {}

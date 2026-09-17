import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HISTORY_LIMITS,
  conversationListResponseSchema,
  conversationSearchQuerySchema,
  conversationResponseSchema,
  conversationSummaryResponseSchema,
  saveConversationRequestSchema,
  uploadConversationAudioQuerySchema,
} from '@chatofy/types';

/**
 * The path parameter, validated as a UUID.
 *
 * Not decoration: the value goes into a btree unique index, and Postgres refuses
 * an index tuple over ~2704 bytes — so an unvalidated multi-kilobyte id is a 500
 * where a 400 belongs. The client mints `crypto.randomUUID()`, so the constraint
 * costs a legitimate caller nothing.
 */
const conversationIdParamSchema = z.object({
  conversationId: z.uuid(),
});

/**
 * The list query.
 *
 * `limit` is coerced because a query string carries text, and it is bounded so
 * the route is never unbounded — the default is a page, the max is a ceiling.
 * `cursor` is the opaque keyset token a previous page returned.
 */
const listConversationsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(HISTORY_LIMITS.MAX_PAGE_SIZE)
    .default(HISTORY_LIMITS.DEFAULT_PAGE_SIZE),
  cursor: z.string().min(1).max(64).optional(),
  /**
   * A search term, trimmed and bounded. Absent lists everything.
   *
   * Bounded rather than free: a one-character term matches a large fraction of
   * any transcript, so it returns most of the caller's history instead of
   * answering a question. See SEARCH_LIMITS for the floor and what it buys.
   */
  q: conversationSearchQuerySchema.optional(),
});

/** PUT /conversations/:conversationId body. */
export class SaveConversationRequestDto extends createZodDto(
  saveConversationRequestSchema,
) {}

/** :conversationId, for every route that carries one. */
export class ConversationIdParamDto extends createZodDto(
  conversationIdParamSchema,
) {}

/**
 * PUT /conversations/:conversationId/audio query string.
 *
 * The timings travel as a query because the BODY is the audio — there is no JSON
 * envelope on that route to carry them in.
 */
export class UploadConversationAudioQueryDto extends createZodDto(
  uploadConversationAudioQuerySchema,
) {}

/** GET /conversations query string. */
export class ListConversationsQueryDto extends createZodDto(
  listConversationsQuerySchema,
) {}

/** Success payloads — used for the OpenAPI envelope schemas. */
export class ConversationResponseDto extends createZodDto(
  conversationResponseSchema,
) {}
export class ConversationListResponseDto extends createZodDto(
  conversationListResponseSchema,
) {}
export class ConversationSummaryResponseDto extends createZodDto(
  conversationSummaryResponseSchema,
) {}

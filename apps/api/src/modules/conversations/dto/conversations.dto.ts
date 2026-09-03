import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HISTORY_LIMITS,
  conversationListResponseSchema,
  conversationSearchQuerySchema,
  conversationResponseSchema,
  conversationSummaryResponseSchema,
  saveConversationRequestSchema,
} from '@chatofy/types';

/**
 * The path parameter, validated as a UUID.
 *
 * Not decoration: the value goes into a btree unique index, and Postgres refuses
 * an index tuple over ~2704 bytes — so an unvalidated multi-kilobyte id is a 500
 * where a 400 belongs. The client mints `crypto.randomUUID()`, so the constraint
 * costs a legitimate caller nothing.
 */
export const conversationIdParamSchema = z.object({
  conversationId: z.uuid(),
});

/**
 * The list query.
 *
 * `limit` is coerced because a query string carries text, and it is bounded so
 * the route is never unbounded — the default is a page, the max is a ceiling.
 * `cursor` is the opaque keyset token a previous page returned.
 */
export const listConversationsQuerySchema = z.object({
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
   * Bounded rather than free: a one-character term cannot use the trigram index
   * and is a guaranteed sequential scan over the caller's whole history.
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

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  ConversationListResponse,
  ConversationResponse,
  ConversationSummaryResponse,
} from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  ConversationIdParamDto,
  ConversationListResponseDto,
  ConversationResponseDto,
  ConversationSummaryResponseDto,
  ListConversationsQueryDto,
  SaveConversationRequestDto,
} from './dto/conversations.dto';
import { ConversationsService } from './conversations.service';

/**
 * A signed-in user's conversation history.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`, so every route requires a bearer token. `@ApiBearerAuth()` is
 * per-route documentation only, as on the other controllers.
 *
 * `ThrottlerGuard` is applied HERE and not inherited: there is no global
 * throttle in this app — the only `APP_GUARD` is `JwtAuthGuard`, and
 * `AuthController` is the sole place a `ThrottlerGuard` is mounted — so a route
 * that does not ask for a limit does not have one. The write is the expensive
 * one (up to a megabyte parsed and a transactional replace); the list is cheap
 * per call but trivially scriptable.
 */
@ApiTags('conversations')
@Controller('conversations')
@UseGuards(ThrottlerGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List the caller's past conversations, newest first",
    description:
      "Cursor-paged. `nextCursor` is in the payload rather than `meta.pagination`: this is keyset paging, and the envelope's pagination block is page-based. Pass it back as `?cursor=` for the next page; null means this was the last. `?q=` narrows to conversations containing the term in their source, repaired or translated text — case-insensitively, and only within the caller's own history.",
  })
  @ApiEnvelopeResponse(ConversationListResponseDto)
  @ApiErrorResponses(400, 401, 429)
  list(
    @Req() req: Request,
    @Query() query: ListConversationsQueryDto,
  ): Promise<ConversationListResponse> {
    return this.conversations.list(req.auth!.userId, {
      limit: query.limit,
      cursor: query.cursor,
      q: query.q,
    });
  }

  @Put(':conversationId')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Save or replace a finished conversation',
    description:
      'PUT rather than POST: the client mints the id and sends the whole conversation, so the write is a full, idempotent replacement — a re-save after a roster edit replaces rather than duplicating. Each turn is one DISPLAYED block, already grouped and repaired by the client, so what is stored is what the user read.',
  })
  @ApiEnvelopeResponse(ConversationSummaryResponseDto)
  // 413 comes from the express parser registered for this path in
  // `narrow-body-limits.ts`, before the route runs — see AllExceptionsFilter for
  // why it still arrives as the standard envelope.
  @ApiErrorResponses(400, 401, 413, 429)
  async save(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Body() body: SaveConversationRequestDto,
  ): Promise<ConversationSummaryResponse> {
    // The owner is the verified token's subject, never the path or body — the
    // same anti-escalation discipline `PATCH /auth/me` documents.
    return {
      conversation: await this.conversations.save(
        req.auth!.userId,
        params.conversationId,
        body,
      ),
    };
  }

  @Get(':conversationId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Read one conversation with its full transcript',
    description:
      'Turns come back in display order. Render each as `displayText ?? sourceText`. 404 for an id the caller does not own, identically to one that does not exist.',
  })
  @ApiEnvelopeResponse(ConversationResponseDto)
  @ApiErrorResponses(400, 401, 404)
  async get(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
  ): Promise<ConversationResponse> {
    return {
      conversation: await this.conversations.get(
        req.auth!.userId,
        params.conversationId,
      ),
    };
  }

  @Delete(':conversationId')
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a conversation and its transcript',
    description:
      'Turns are removed with it. 404 for an id the caller does not own, identically to one that does not exist.',
  })
  @ApiErrorResponses(400, 401, 404)
  remove(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
  ): Promise<void> {
    return this.conversations.remove(req.auth!.userId, params.conversationId);
  }
}

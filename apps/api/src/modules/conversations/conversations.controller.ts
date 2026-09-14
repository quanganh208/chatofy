import { pipeline } from 'node:stream/promises';
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
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CONVERSATION_AUDIO_CACHE_CONTROL } from '../storage/r2-conversation-audio-storage';
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
  UploadConversationAudioQueryDto,
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

  /**
   * Store this conversation's recording.
   *
   * The body is raw audio, not JSON. `registerNarrowBodyLimits` mounts an
   * `express.raw` parser on this exact path with the 32 MB ceiling, so an
   * oversized body takes a 413 BEFORE this method runs — the same guarantee the
   * JSON ceiling on the parent path already gives. The two parsers dispatch on
   * `Content-Type` and never see each other's bodies.
   *
   * Throttled harder than the save (6/min against 30) because the memory bound
   * here is 32 MB times whatever is in flight — the same shape as
   * `turn-concurrency.ts`'s `MAX_TURN_BYTES × concurrency`.
   */
  @Put(':conversationId/audio')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({
    summary: "Store a conversation's recording",
    description:
      'Body is raw `audio/webm` or `audio/mp4`; the container is decided by sniffing the bytes, never by the declared type. `offsetMs` is how long after the conversation started the first sample landed, and `durationMs` is the recording length — both measured by the recorder, so a timestamp can be placed inside the media. 404 for an id the caller does not own, identically to one that does not exist; 409 when storage is unconfigured or unreachable; 413 from the parser; 415 for bytes that are not audio this API stores.',
  })
  @ApiErrorResponses(400, 401, 404, 409, 413, 415)
  async putAudio(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Query() query: UploadConversationAudioQueryDto,
    @Body() body: Buffer,
  ): Promise<void> {
    await this.conversations.setAudio(
      req.auth!.userId,
      params.conversationId,
      body,
      { offsetMs: query.offsetMs, durationMs: query.durationMs },
    );
  }

  /**
   * Stream this conversation's recording back to its owner.
   *
   * **`@Res()` non-passthrough, deliberately, and do not "fix" this back into a
   * returned value.** `TransformInterceptor` maps every non-`/health` handler
   * return through the `{success, data, meta}` envelope, and Nest's
   * `instanceof StreamableFile` check runs AFTER interceptors on the already
   * mapped value — so returning a `StreamableFile` here ships a JSON body with a
   * serialised stream inside it, not audio. Writing the response directly is what
   * bypasses the interceptor.
   *
   * `response-envelope.e2e-spec.ts` is where the envelope rule is asserted; the
   * e2e for this route asserts the opposite for exactly this path.
   */
  @Get(':conversationId/audio')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: "Stream a conversation's recording",
    description:
      'Returns the raw audio bytes with no success envelope — this is the one route in the API that answers with a body rather than a wrapped payload. 404 for an id the caller does not own, one that does not exist, and one with no recording, all identically.',
  })
  @ApiErrorResponses(400, 401, 404, 409)
  async getAudio(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Res() res: Response,
  ): Promise<void> {
    const object = await this.conversations.getAudio(
      req.auth!.userId,
      params.conversationId,
    );
    res.setHeader('Content-Type', object.contentType);
    res.setHeader('Cache-Control', CONVERSATION_AUDIO_CACHE_CONTROL);
    if (object.contentLength > 0) {
      res.setHeader('Content-Length', String(object.contentLength));
    }
    await pipeline(object.body, res);
  }

  @Delete(':conversationId')
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a conversation, its transcript and its recording',
    description:
      'Turns are removed with it, and the recording object is deleted BEFORE the row so a failure leaves both in place rather than orphaning bytes nothing points at. 404 for an id the caller does not own, identically to one that does not exist; 409 when the recording could not be removed.',
  })
  @ApiErrorResponses(400, 401, 404, 409)
  remove(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
  ): Promise<void> {
    return this.conversations.remove(req.auth!.userId, params.conversationId);
  }
}

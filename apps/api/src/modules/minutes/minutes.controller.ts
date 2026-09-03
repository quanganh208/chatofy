import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { MinutesResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { ConversationIdParamDto } from '../conversations/dto/conversations.dto';
import {
  GenerateMinutesRequestDto,
  MinutesResponseDto,
} from './dto/minutes.dto';
import { MinutesService } from './minutes.service';

/**
 * Meeting-minutes endpoints for a stored conversation.
 *
 * Generation is a POST because it is not idempotent — it spends an LLM call and
 * OVERWRITES any previous minutes for the conversation. The read is a plain GET.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`, so both routes require a bearer token. `@ApiBearerAuth()` is
 * per-route documentation only, for the same reason it is on TranslateController.
 *
 * `ThrottlerGuard` is mounted HERE, not inherited: there is no global throttle
 * in this app. Generation needs one more than it used to — the body went from
 * carrying the transcript to ~20 bytes while the server now loads up to 80k
 * characters into a billed call, which is roughly a 4000:1 cost amplifier on a
 * request an attacker can repeat cheaply.
 */
@ApiTags('minutes')
@Controller('conversations/:conversationId/minutes')
@UseGuards(ThrottlerGuard)
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @Post()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Generate meeting minutes from a stored conversation',
    description:
      "Reads the conversation's stored turns — the body carries only the language to write in. Runs one LLM pass and answers with the summary, key points, decisions, and action items. Regenerating overwrites the previous minutes. 404 for a conversation the caller does not own, answered before any LLM call is spent.",
  })
  @ApiEnvelopeResponse(MinutesResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async generate(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
    @Body() body: GenerateMinutesRequestDto,
  ): Promise<MinutesResponse> {
    // The owner is the verified token's subject, never the path or body — the
    // same anti-escalation discipline `PATCH /auth/me` documents.
    return {
      minutes: await this.minutes.generate(
        req.auth!.userId,
        params.conversationId,
        body,
      ),
    };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fetch the minutes previously generated for a conversation',
    description:
      'Returns the stored minutes, including a `failed` record if the last generation threw. 404 when none have been generated, and the same 404 for a conversation the caller does not own.',
  })
  @ApiEnvelopeResponse(MinutesResponseDto)
  @ApiErrorResponses(400, 401, 404)
  async get(
    @Req() req: Request,
    @Param() params: ConversationIdParamDto,
  ): Promise<MinutesResponse> {
    // Scoped to the caller: the store resolves the conversation by
    // (ownerId, clientId) before it looks for a minutes row, so a foreign or
    // guessed id answers 404 — the same reply as genuinely-absent, and it leaks
    // nothing about whether another user has minutes under that id.
    const minutes = await this.minutes.get(
      req.auth!.userId,
      params.conversationId,
    );
    if (!minutes) {
      throw new NotFoundException(
        `no minutes have been generated for conversation ${params.conversationId}`,
      );
    }
    return { minutes };
  }
}

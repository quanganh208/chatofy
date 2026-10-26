import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  ConferenceDetailResponse,
  ConferenceListResponse,
  ConferenceResponse,
} from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  ConferenceDetailResponseDto,
  ConferenceIdParamDto,
  ConferenceListQueryDto,
  ConferenceListResponseDto,
  ConferenceResponseDto,
  CreateConferenceRequestDto,
} from './dto/conference.dto';
import { ConferenceService } from './conference.service';

/**
 * Conference room management.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`, so every route requires a bearer token.
 *
 * The caller's identity is always read from `req.auth!.userId` — never from a
 * path or body field, which is the anti-IDOR discipline every other controller
 * in this app applies.
 */
@ApiTags('conference')
@Controller('conference')
@UseGuards(ThrottlerGuard)
export class ConferenceController {
  constructor(private readonly conferenceService: ConferenceService) {}

  @Post()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new conference room' })
  @ApiEnvelopeResponse(ConferenceResponseDto)
  @ApiErrorResponses(400, 401, 429)
  create(
    @Req() req: Request,
    @Body() body: CreateConferenceRequestDto,
  ): Promise<ConferenceResponse> {
    return this.conferenceService.create(req.auth!.userId, body);
  }

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "List the caller's conferences (owner or participant), newest first",
    description:
      'Page-based. Pass ?page and ?limit (default 1/20, max limit 100).',
  })
  @ApiEnvelopeResponse(ConferenceListResponseDto)
  @ApiErrorResponses(400, 401, 429)
  list(
    @Req() req: Request,
    @Query() query: ConferenceListQueryDto,
  ): Promise<ConferenceListResponse> {
    return this.conferenceService.list(req.auth!.userId, {
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Get a conference by id',
    description: '404 when the caller has no row (IDOR guard).',
  })
  @ApiEnvelopeResponse(ConferenceDetailResponseDto)
  @ApiErrorResponses(401, 404, 429)
  findOne(
    @Req() req: Request,
    @Param() params: ConferenceIdParamDto,
  ): Promise<ConferenceDetailResponse> {
    return this.conferenceService.findOne(params.id, req.auth!.userId);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'End a conference room',
    description:
      'Sets status=ended, endedAt=now(). 403 when caller is not the owner.',
  })
  @ApiEnvelopeResponse(ConferenceResponseDto)
  @ApiErrorResponses(401, 403, 404, 429)
  end(
    @Req() req: Request,
    @Param() params: ConferenceIdParamDto,
  ): Promise<ConferenceResponse> {
    return this.conferenceService.end(params.id, req.auth!.userId);
  }
}

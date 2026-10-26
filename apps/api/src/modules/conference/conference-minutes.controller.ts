import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  ConferenceMinutesResponse,
  StoredConferenceMinutesResponse,
} from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  ConferenceIdParamDto,
  ConferenceMinutesResponseDto,
  GenerateConferenceMinutesRequestDto,
  StoredConferenceMinutesResponseDto,
} from './dto/conference.dto';
import { ConferenceMinutesService } from './services/conference-minutes.service';

/**
 * Meeting minutes for a conference room.
 *
 * Readable and (re)generable by the owner and every participant; 404 for
 * anybody else, the same answer `GET /conference/:id` gives them. The caller is
 * the verified token's subject, never a path or body field.
 *
 * `ThrottlerGuard` is mounted HERE because there is no global throttle, and the
 * generate route needs it for the reason `MinutesController` gives: a ~20-byte
 * body loads up to MINUTES_LIMITS.MAX_TOTAL_CHARS of stored turns into a billed
 * call.
 */
@ApiTags('conference')
@Controller('conference/:id/minutes')
@UseGuards(ThrottlerGuard)
export class ConferenceMinutesController {
  constructor(private readonly minutes: ConferenceMinutesService) {}

  @Post()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: "Generate a conference's minutes from its stored turns",
    description:
      "Summarizes the room's stored speech turns in the requested language and replaces any earlier copy — one per room. Any participant may call it. 404 for a room the caller was not in and 400 for one with nothing said, both before any LLM call is spent.",
  })
  @ApiEnvelopeResponse(ConferenceMinutesResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async generate(
    @Req() req: Request,
    @Param() params: ConferenceIdParamDto,
    @Body() body: GenerateConferenceMinutesRequestDto,
  ): Promise<ConferenceMinutesResponse> {
    return {
      minutes: await this.minutes.generate(params.id, req.auth!.userId, body),
    };
  }

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "Fetch a conference's minutes",
    description:
      '`minutes` is null when nobody has generated them yet, and a `failed` record when the last pass threw. 404 for a room the caller was not in.',
  })
  @ApiEnvelopeResponse(StoredConferenceMinutesResponseDto)
  @ApiErrorResponses(401, 404, 429)
  async get(
    @Req() req: Request,
    @Param() params: ConferenceIdParamDto,
  ): Promise<StoredConferenceMinutesResponse> {
    return {
      minutes: await this.minutes.get(params.id, req.auth!.userId),
    };
  }
}

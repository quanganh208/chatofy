import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MinutesResponse } from '@chatofy/types';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  GenerateMinutesRequestDto,
  MinutesResponseDto,
} from './dto/minutes.dto';
import { MinutesService } from './minutes.service';

/**
 * Meeting-minutes endpoints for a conversation session.
 *
 * Generation is a POST because it is not idempotent — it spends an LLM call and
 * OVERWRITES any previous minutes for the session. The read is a plain GET.
 *
 * Authenticated: `JwtAuthGuard` is a global `APP_GUARD` and nothing here is
 * `@Public()`, so both routes require a bearer token. `@ApiBearerAuth()` is
 * per-route documentation only, for the same reason it is on TranslateController.
 */
@ApiTags('minutes')
@Controller('sessions/:sessionId/minutes')
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate meeting minutes for a session from its transcript',
    description:
      'Send the finished conversation as an ordered list of `{ speakerLabel, text }` turns. Runs one LLM pass and answers with the summary, key points, decisions, and action items. Regenerating overwrites the previous minutes for this session.',
  })
  @ApiEnvelopeResponse(MinutesResponseDto)
  @ApiErrorResponses(400, 401)
  async generate(
    @Param('sessionId') sessionId: string,
    @Body() body: GenerateMinutesRequestDto,
  ): Promise<MinutesResponse> {
    return { minutes: await this.minutes.generate(sessionId, body) };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fetch the meeting minutes previously generated for a session',
    description:
      'Returns the stored minutes, including a `failed` record if the last generation threw. 404 when none have been generated for this session.',
  })
  @ApiEnvelopeResponse(MinutesResponseDto)
  @ApiErrorResponses(401, 404)
  async get(@Param('sessionId') sessionId: string): Promise<MinutesResponse> {
    const minutes = await this.minutes.get(sessionId);
    if (!minutes) {
      throw new NotFoundException(
        `no minutes have been generated for session ${sessionId}`,
      );
    }
    return { minutes };
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { TranslationContextListResponse } from '@chatofy/types';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { TeamAccessService } from '../teams/team-access.service';
import {
  SaveTranslationContextRequestDto,
  TeamContextIdParamDto,
  TeamContextsParamDto,
  TranslationContextListResponseDto,
  TranslationContextResponseDto,
} from './dto/translation-contexts.dto';
import { TranslationContextsService } from './translation-contexts.service';

/**
 * A team's shared AI Contexts: list, save and delete, scoped to `:teamId`.
 *
 * The scope is resolved through `TeamAccessService` before anything else, so
 * a non-member gets 404. Any member creates; only the author, an admin or the
 * owner replaces or deletes an existing context (403). A team context links
 * only a glossary of the same team.
 */
@ApiTags('teams')
@Controller('teams/:teamId/translation-contexts')
@UseGuards(UserThrottlerGuard)
export class TeamTranslationContextsController {
  constructor(
    private readonly contexts: TranslationContextsService,
    private readonly access: TeamAccessService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List a team's AI Contexts, newest first",
    description: 'Any member. Each context carries `canEdit` for the caller.',
  })
  @ApiEnvelopeResponse(TranslationContextListResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async list(
    @Req() req: Request,
    @Param() params: TeamContextsParamDto,
  ): Promise<TranslationContextListResponse> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return { contexts: await this.contexts.list(scope) };
  }

  @Put(':contextId')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Save or replace one team AI Context',
    description:
      'Any member creates; only the author or an admin replaces (403). 409 at the team limit, or when the id is already used by any AI Context. 400 when the linked glossary is not one of this team.',
  })
  @ApiEnvelopeResponse(TranslationContextResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async save(
    @Req() req: Request,
    @Param() params: TeamContextIdParamDto,
    @Body() body: SaveTranslationContextRequestDto,
  ) {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return {
      context: await this.contexts.save(scope, params.contextId, body),
    };
  }

  @Delete(':contextId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Delete one team AI Context',
    description:
      '204 whether a row went or not; 403 for a member who did not author it.',
  })
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async remove(
    @Req() req: Request,
    @Param() params: TeamContextIdParamDto,
  ): Promise<void> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    await this.contexts.remove(scope, params.contextId);
  }
}

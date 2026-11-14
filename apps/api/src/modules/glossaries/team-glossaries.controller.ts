import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  GlossaryItemListResponse,
  GlossaryListResponse,
} from '@chatofy/types';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import { TeamAccessService } from '../teams/team-access.service';
import {
  GlossaryItemListResponseDto,
  GlossaryItemResponseDto,
  GlossaryListResponseDto,
  GlossaryResponseDto,
  PatchGlossaryRequestDto,
  SaveGlossaryItemRequestDto,
  SaveGlossaryRequestDto,
  TeamGlossaryIdParamDto,
  TeamItemIdParamDto,
  TeamParamDto,
} from './dto/glossaries.dto';
import { GlossariesService } from './glossaries.service';

/**
 * A team's shared glossaries: the same seven routes as `GlossariesController`,
 * scoped to `:teamId`.
 *
 * Every handler resolves the scope through `TeamAccessService` FIRST, so a
 * non-member gets 404 before anything is read. Any member reads and creates;
 * only the author, an admin or the owner changes an existing glossary, which
 * the store enforces inside each write's transaction and answers with 403.
 */
@ApiTags('teams')
@Controller('teams/:teamId/glossaries')
@UseGuards(UserThrottlerGuard)
export class TeamGlossariesController {
  constructor(
    private readonly glossaries: GlossariesService,
    private readonly access: TeamAccessService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List a team's glossaries, newest first",
    description: 'Any member. Each glossary carries `canEdit` for the caller.',
  })
  @ApiEnvelopeResponse(GlossaryListResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async list(
    @Req() req: Request,
    @Param() params: TeamParamDto,
  ): Promise<GlossaryListResponse> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return { glossaries: await this.glossaries.listGlossaries(scope) };
  }

  @Put(':glossaryId')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create or update a team glossary',
    description:
      'Any member creates; only the author or an admin updates (403). 409 at the team limit, or when the id is already used by any glossary.',
  })
  @ApiEnvelopeResponse(GlossaryResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async save(
    @Req() req: Request,
    @Param() params: TeamGlossaryIdParamDto,
    @Body() body: SaveGlossaryRequestDto,
  ) {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return {
      glossary: await this.glossaries.saveGlossary(
        scope,
        params.glossaryId,
        body,
      ),
    };
  }

  @Patch(':glossaryId')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Toggle a team glossary active state' })
  @ApiEnvelopeResponse(GlossaryResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async patch(
    @Req() req: Request,
    @Param() params: TeamGlossaryIdParamDto,
    @Body() body: PatchGlossaryRequestDto,
  ) {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return {
      glossary: await this.glossaries.patchGlossary(
        scope,
        params.glossaryId,
        body,
      ),
    };
  }

  @Delete(':glossaryId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete a team glossary and all its terms' })
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async remove(
    @Req() req: Request,
    @Param() params: TeamGlossaryIdParamDto,
  ): Promise<void> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    await this.glossaries.removeGlossary(scope, params.glossaryId);
  }

  @Get(':glossaryId/items')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List terms in a team glossary' })
  @ApiEnvelopeResponse(GlossaryItemListResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async listItems(
    @Req() req: Request,
    @Param() params: TeamGlossaryIdParamDto,
  ): Promise<GlossaryItemListResponse> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return {
      items: await this.glossaries.listItems(scope, params.glossaryId),
    };
  }

  @Post(':glossaryId/items')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Add a term pair to a team glossary',
    description:
      'Only the author or an admin (403). clientId in the body provides idempotency.',
  })
  @ApiEnvelopeResponse(GlossaryItemResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async addItem(
    @Req() req: Request,
    @Param() params: TeamGlossaryIdParamDto,
    @Body() body: SaveGlossaryItemRequestDto,
  ) {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return {
      item: await this.glossaries.addItem(scope, params.glossaryId, body),
    };
  }

  @Delete(':glossaryId/items/:itemId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete one term from a team glossary' })
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async removeItem(
    @Req() req: Request,
    @Param() params: TeamItemIdParamDto,
  ): Promise<void> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    await this.glossaries.removeItem(scope, params.glossaryId, params.itemId);
  }
}

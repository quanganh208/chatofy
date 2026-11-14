import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { TeamListResponse, TeamResponse } from '@chatofy/types';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  CreateTeamRequestDto,
  RenameTeamRequestDto,
  TeamIdParamDto,
  TeamListResponseDto,
  TeamResponseDto,
} from './dto/teams.dto';
import { TeamAccessService } from './team-access.service';
import { TeamsService } from './teams.service';

/**
 * Teams the signed-in account belongs to.
 *
 * Authenticated by the global `JwtAuthGuard`; throttled per ACCOUNT
 * (`UserThrottlerGuard`), as preferences are. The caller is always
 * `req.auth!.userId`, never a path or body field. Membership and role are
 * checked per request by `TeamAccessService`: a non-member gets 404, a member
 * below the required role 403.
 */
@ApiTags('teams')
@Controller('teams')
@UseGuards(UserThrottlerGuard)
export class TeamsController {
  constructor(
    private readonly teams: TeamsService,
    private readonly access: TeamAccessService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create a team',
    description:
      'The caller becomes its owner. 409 when the caller is already in the maximum number of teams.',
  })
  @ApiEnvelopeResponse(TeamResponseDto)
  @ApiErrorResponses(400, 401, 409, 429)
  async create(
    @Req() req: Request,
    @Body() body: CreateTeamRequestDto,
  ): Promise<TeamResponse> {
    return { team: await this.teams.create(req.auth!.userId, body.name) };
  }

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List the caller's teams",
    description: 'Oldest membership first, each with the caller’s own role.',
  })
  @ApiEnvelopeResponse(TeamListResponseDto)
  @ApiErrorResponses(401, 429)
  async list(@Req() req: Request): Promise<TeamListResponse> {
    return { teams: await this.teams.list(req.auth!.userId) };
  }

  @Patch(':teamId')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rename a team', description: 'Owner only.' })
  @ApiEnvelopeResponse(TeamResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async rename(
    @Req() req: Request,
    @Param() params: TeamIdParamDto,
    @Body() body: RenameTeamRequestDto,
  ): Promise<TeamResponse> {
    const scope = await this.access.resolve(
      req.auth!.userId,
      params.teamId,
      'owner',
    );
    return { team: await this.teams.rename(scope, body.name) };
  }

  @Delete(':teamId')
  @HttpCode(204)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Delete a team',
    description:
      'Owner only. Members, invites and the team’s glossaries and AI Contexts are deleted with it.',
  })
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async remove(
    @Req() req: Request,
    @Param() params: TeamIdParamDto,
  ): Promise<void> {
    const scope = await this.access.resolve(
      req.auth!.userId,
      params.teamId,
      'owner',
    );
    await this.teams.remove(scope);
  }
}

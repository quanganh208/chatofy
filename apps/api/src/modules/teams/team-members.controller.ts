import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  TeamMemberListResponse,
  TeamMemberResponse,
} from '@chatofy/types';
import { UserThrottlerGuard } from '../auth/user-throttler.guard';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../common/swagger/api-error-response.helper';
import {
  ChangeMemberRoleRequestDto,
  TeamIdParamDto,
  TeamMemberListResponseDto,
  TeamMemberParamDto,
  TeamMemberResponseDto,
} from './dto/teams.dto';
import { TeamAccessService } from './team-access.service';
import { TeamMembersService } from './team-members.service';

/**
 * A team's members. `:memberId` is the TeamMember row id, never a user id.
 * Same authentication and per-account throttle as `TeamsController`.
 */
@ApiTags('teams')
@Controller('teams/:teamId/members')
@UseGuards(UserThrottlerGuard)
export class TeamMembersController {
  constructor(
    private readonly members: TeamMembersService,
    private readonly access: TeamAccessService,
  ) {}

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List a team's members",
    description:
      'Any member. Emails are shown to owners and admins, and to each member for their own row only.',
  })
  @ApiEnvelopeResponse(TeamMemberListResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  async list(
    @Req() req: Request,
    @Param() params: TeamIdParamDto,
  ): Promise<TeamMemberListResponse> {
    const scope = await this.access.resolve(req.auth!.userId, params.teamId);
    return { members: await this.members.list(scope) };
  }

  @Patch(':memberId')
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: "Change a member's role",
    description: "Owner only. 409 for the owner's own row.",
  })
  @ApiEnvelopeResponse(TeamMemberResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async changeRole(
    @Req() req: Request,
    @Param() params: TeamMemberParamDto,
    @Body() body: ChangeMemberRoleRequestDto,
  ): Promise<TeamMemberResponse> {
    const scope = await this.access.resolve(
      req.auth!.userId,
      params.teamId,
      'owner',
    );
    return {
      member: await this.members.changeRole(scope, params.memberId, body.role),
    };
  }

  @Delete(':memberId')
  @HttpCode(204)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Remove a member, or leave',
    description:
      'Removing yourself is leaving (not allowed for the owner: 409). Admins remove members; only the owner removes admins.',
  })
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async remove(
    @Req() req: Request,
    @Param() params: TeamMemberParamDto,
  ): Promise<void> {
    await this.members.remove(req.auth!.userId, params.teamId, params.memberId);
  }
}

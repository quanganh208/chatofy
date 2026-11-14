import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  TeamInviteListResponse,
  TeamInviteResponse,
} from '@chatofy/types';
import { UserThrottlerGuard } from '../../auth/user-throttler.guard';
import { ApiEnvelopeResponse } from '../../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../../common/swagger/api-error-response.helper';
import {
  CreateTeamInviteRequestDto,
  TeamIdParamDto,
  TeamInviteListResponseDto,
  TeamInviteParamDto,
  TeamInviteResponseDto,
} from '../dto/teams.dto';
import { TeamInvitesService } from './team-invites.service';

/**
 * A team's invites: create, list and withdraw. Admins and the owner only. An
 * invite is never sent twice; to repeat one, withdraw it and invite again.
 */
@ApiTags('teams')
@Controller('teams/:teamId/invites')
@UseGuards(UserThrottlerGuard)
export class TeamInvitesController {
  constructor(private readonly invites: TeamInvitesService) {}

  @Post()
  @ApiBearerAuth()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Invite an email address to the team',
    description:
      'Admins invite members; only the owner invites admins (403). Mails a single-use link valid for 7 days. 409 when the person is already a member, an invite to the address is pending, the address was invited recently in any team, or the team has no seats left. 429 past 20 invites per inviter per 24 hours.',
  })
  @ApiEnvelopeResponse(TeamInviteResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async create(
    @Req() req: Request,
    @Param() params: TeamIdParamDto,
    @Body() body: CreateTeamInviteRequestDto,
  ): Promise<TeamInviteResponse> {
    return {
      invite: await this.invites.create(req.auth!.userId, params.teamId, body),
    };
  }

  @Get()
  @ApiBearerAuth()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: "List the team's open invites, newest first",
    description: 'Admins and the owner. Expired invites are listed as expired.',
  })
  @ApiEnvelopeResponse(TeamInviteListResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async list(
    @Req() req: Request,
    @Param() params: TeamIdParamDto,
  ): Promise<TeamInviteListResponse> {
    return {
      invites: await this.invites.list(req.auth!.userId, params.teamId),
    };
  }

  @Delete(':inviteId')
  @ApiBearerAuth()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Withdraw an invite',
    description: 'Idempotent: 204 whether or not the invite was still open.',
  })
  @ApiErrorResponses(400, 401, 403, 404, 429)
  async revoke(
    @Req() req: Request,
    @Param() params: TeamInviteParamDto,
  ): Promise<void> {
    await this.invites.revoke(req.auth!.userId, params.teamId, params.inviteId);
  }
}

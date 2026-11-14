import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  AcceptInviteResponse,
  InvitePreviewResponse,
} from '@chatofy/types';
import { UserThrottlerGuard } from '../../auth/user-throttler.guard';
import { ApiEnvelopeResponse } from '../../../common/swagger/api-envelope-response.helper';
import { ApiErrorResponses } from '../../../common/swagger/api-error-response.helper';
import {
  AcceptInviteResponseDto,
  InvitePreviewResponseDto,
  InviteTokenRequestDto,
} from '../dto/teams.dto';
import { TeamInviteAcceptanceService } from './team-invite-acceptance.service';

/**
 * The invitee's side: preview an invite, then accept it. The token is always
 * in the body, so no URL, log line or history entry carries it.
 */
@ApiTags('teams')
@Controller('team-invites')
@UseGuards(UserThrottlerGuard)
export class TeamInviteAcceptanceController {
  constructor(private readonly acceptance: TeamInviteAcceptanceService) {}

  @Post('preview')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Preview an invite without spending it',
    description:
      'Status is one of pending, accepted, revoked, expired, wrong-account, already-member, team-cap or team-full. A caller signed in as another address gets wrong-account and no team details. 404 for an unknown token.',
  })
  @ApiEnvelopeResponse(InvitePreviewResponseDto)
  @ApiErrorResponses(400, 401, 404, 429)
  preview(
    @Req() req: Request,
    @Body() body: InviteTokenRequestDto,
  ): Promise<InvitePreviewResponse> {
    return this.acceptance.preview(req.auth!.userId, body.token);
  }

  @Post('accept')
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Accept an invite and join the team',
    description:
      '403 when signed in as a different address than the invite was sent to. 409 carries code `INVITE_NOT_PENDING` and `details: [{ path: "status", message: <accepted | revoked | expired | team-cap | team-full> }]`. Accepting while already a member answers the team again and leaves the invite unspent. 404 for an unknown token or a deleted team.',
  })
  @ApiEnvelopeResponse(AcceptInviteResponseDto)
  @ApiErrorResponses(400, 401, 403, 404, 409, 429)
  async accept(
    @Req() req: Request,
    @Body() body: InviteTokenRequestDto,
  ): Promise<AcceptInviteResponse> {
    return {
      team: await this.acceptance.accept(req.auth!.userId, body.token),
    };
  }
}

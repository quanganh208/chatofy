import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  acceptInviteResponseSchema,
  changeMemberRoleRequestSchema,
  createTeamInviteRequestSchema,
  createTeamRequestSchema,
  invitePreviewResponseSchema,
  inviteTokenRequestSchema,
  teamInviteListResponseSchema,
  teamInviteResponseSchema,
  renameTeamRequestSchema,
  teamIdSchema,
  teamListResponseSchema,
  teamMemberListResponseSchema,
  teamMemberResponseSchema,
  teamResponseSchema,
} from '@chatofy/types';

export const teamIdParamSchema = z.object({ teamId: teamIdSchema });
/** Members are addressed by their TeamMember row id, never by user id. */
export const teamMemberParamSchema = z.object({
  teamId: teamIdSchema,
  memberId: z.cuid(),
});

export class CreateTeamRequestDto extends createZodDto(
  createTeamRequestSchema,
) {}
export class RenameTeamRequestDto extends createZodDto(
  renameTeamRequestSchema,
) {}
export class ChangeMemberRoleRequestDto extends createZodDto(
  changeMemberRoleRequestSchema,
) {}

export class TeamIdParamDto extends createZodDto(teamIdParamSchema) {}
export class TeamMemberParamDto extends createZodDto(teamMemberParamSchema) {}

export class TeamResponseDto extends createZodDto(teamResponseSchema) {}
export class TeamListResponseDto extends createZodDto(teamListResponseSchema) {}
export class TeamMemberListResponseDto extends createZodDto(
  teamMemberListResponseSchema,
) {}
export class TeamMemberResponseDto extends createZodDto(
  teamMemberResponseSchema,
) {}

/** Invites are addressed by their TeamInvite row id. */
export const teamInviteParamSchema = z.object({
  teamId: teamIdSchema,
  inviteId: z.cuid(),
});
export class TeamInviteParamDto extends createZodDto(teamInviteParamSchema) {}
export class CreateTeamInviteRequestDto extends createZodDto(
  createTeamInviteRequestSchema,
) {}
/** The invite token travels in the body, never in a URL. */
export class InviteTokenRequestDto extends createZodDto(
  inviteTokenRequestSchema,
) {}
export class TeamInviteResponseDto extends createZodDto(
  teamInviteResponseSchema,
) {}
export class TeamInviteListResponseDto extends createZodDto(
  teamInviteListResponseSchema,
) {}
export class InvitePreviewResponseDto extends createZodDto(
  invitePreviewResponseSchema,
) {}
export class AcceptInviteResponseDto extends createZodDto(
  acceptInviteResponseSchema,
) {}

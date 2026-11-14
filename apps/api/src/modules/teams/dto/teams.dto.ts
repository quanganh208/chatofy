import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  changeMemberRoleRequestSchema,
  createTeamRequestSchema,
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

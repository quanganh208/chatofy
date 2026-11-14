import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TeamAccessService } from './team-access.service';
import { TeamMembersController } from './team-members.controller';
import { TeamMembersService } from './team-members.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamInvitesController } from './invites/team-invites.controller';
import { TeamInvitesService } from './invites/team-invites.service';
import { TeamInviteAcceptanceController } from './invites/team-invite-acceptance.controller';
import { TeamInviteAcceptanceService } from './invites/team-invite-acceptance.service';

/**
 * Teams, their members and roles.
 *
 * `TeamAccessService` is exported so the library modules (glossaries, AI
 * Contexts) and invites can scope a request to a team; it is the only place a
 * team scope is minted. `AuthModule` is imported for `UserThrottlerGuard`
 * and for `AuthMailer`, which sends the invite mail.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    TeamsController,
    TeamMembersController,
    TeamInvitesController,
    TeamInviteAcceptanceController,
  ],
  providers: [
    TeamAccessService,
    TeamsService,
    TeamMembersService,
    TeamInvitesService,
    TeamInviteAcceptanceService,
  ],
  exports: [TeamAccessService],
})
export class TeamsModule {}

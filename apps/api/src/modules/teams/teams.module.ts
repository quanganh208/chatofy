import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TeamAccessService } from './team-access.service';
import { TeamMembersController } from './team-members.controller';
import { TeamMembersService } from './team-members.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/**
 * Teams, their members and roles.
 *
 * `TeamAccessService` is exported so the library modules (glossaries, AI
 * Contexts) and invites can scope a request to a team; it is the only place a
 * team scope is minted. `AuthModule` is imported for `UserThrottlerGuard`.
 */
@Module({
  imports: [AuthModule],
  controllers: [TeamsController, TeamMembersController],
  providers: [TeamAccessService, TeamsService, TeamMembersService],
  exports: [TeamAccessService],
})
export class TeamsModule {}

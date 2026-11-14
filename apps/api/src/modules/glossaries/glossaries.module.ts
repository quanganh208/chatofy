import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TeamsModule } from '../teams/teams.module';
import { GLOSSARY_STORE } from './interfaces/glossary-store.interface';
import { PrismaGlossaryStore } from './stores/prisma-glossary.store';
import { GlossariesController } from './glossaries.controller';
import { TeamGlossariesController } from './team-glossaries.controller';
import { GlossariesService } from './glossaries.service';

@Module({
  imports: [AuthModule, TeamsModule],
  controllers: [GlossariesController, TeamGlossariesController],
  providers: [
    GlossariesService,
    { provide: GLOSSARY_STORE, useClass: PrismaGlossaryStore },
  ],
})
export class GlossariesModule {}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import {
  GLOSSARY_STORE,
  type GlossaryStore,
} from './interfaces/glossary-store.interface';
import { MemoryGlossaryStore } from './stores/memory-glossary.store';
import { PrismaGlossaryStore } from './stores/prisma-glossary.store';
import { GlossaryController } from './glossary.controller';
import { GlossaryService } from './glossary.service';

/**
 * Glossary module.
 *
 * CRUD + bulk import for a user's domain-term glossary under `/glossary`. Which
 * store binds is decided once, here, from `GLOSSARY_STORE_BACKEND` — the same
 * "config decides the seam at construction" pattern MinutesModule uses. Defaults
 * to memory, so the app and the non-DB e2e suite boot with no glossary table; a
 * deployment sets `prisma` to make a user's glossary durable.
 */
@Module({
  imports: [AuthModule],
  controllers: [GlossaryController],
  providers: [
    {
      provide: GLOSSARY_STORE,
      inject: [ConfigService, PrismaService],
      useFactory: (
        config: ConfigService<Env, true>,
        prisma: PrismaService,
      ): GlossaryStore =>
        config.get('GLOSSARY_STORE_BACKEND', { infer: true }) === 'prisma'
          ? new PrismaGlossaryStore(prisma)
          : new MemoryGlossaryStore(),
    },
    GlossaryService,
  ],
})
export class GlossaryModule {}

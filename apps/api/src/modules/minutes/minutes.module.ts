import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { registerDefaultProviders } from '../translate/providers/register-default-providers';
import {
  MINUTES_STORE,
  type MinutesStore,
} from './interfaces/minutes-store.interface';
import { MemoryMinutesStore } from './stores/memory-minutes.store';
import { PrismaMinutesStore } from './stores/prisma-minutes.store';
import { MinutesController } from './minutes.controller';
import { MinutesService } from './minutes.service';

/**
 * Minutes module.
 *
 * POST /sessions/:sessionId/minutes runs one LLM pass over a submitted
 * transcript and stores the result; GET reads it back. The summarization
 * provider is resolved by `resolveOnly` through the ProviderRegistry populated
 * from the shared composition root (register-default-providers.ts) — the same
 * registry the translate module builds, constructed here independently so the
 * two modules share the registration list without depending on each other's
 * lifecycle.
 *
 * Which store binds is decided once, here, from `MINUTES_STORE_BACKEND` — the
 * same "config decides the seam at construction" pattern StorageModule uses for
 * AVATAR_STORAGE. Nothing above this module branches on whether minutes are
 * persisted. Defaults to memory, so the app and the non-DB e2e suite boot with
 * no minutes table; a deployment sets `prisma` to make minutes durable.
 */
@Module({
  imports: [AuthModule],
  controllers: [MinutesController],
  providers: [
    {
      provide: ProviderRegistry,
      useFactory: () => registerDefaultProviders(new ProviderRegistry()),
    },
    {
      provide: MINUTES_STORE,
      inject: [ConfigService, PrismaService],
      useFactory: (
        config: ConfigService<Env, true>,
        prisma: PrismaService,
      ): MinutesStore =>
        config.get('MINUTES_STORE_BACKEND', { infer: true }) === 'prisma'
          ? new PrismaMinutesStore(prisma)
          : new MemoryMinutesStore(),
    },
    MinutesService,
  ],
})
export class MinutesModule {}

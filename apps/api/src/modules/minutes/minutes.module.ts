import { Module } from '@nestjs/common';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { AuthModule } from '../auth/auth.module';
import { registerDefaultProviders } from '../translate/providers/register-default-providers';
import { MINUTES_STORE } from './interfaces/minutes-store.interface';
import { MemoryMinutesStore } from './stores/memory-minutes.store';
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
 * The store is bound to the in-memory implementation for now; swap this one
 * provider line for a PrismaMinutesStore to make minutes outlive a restart.
 */
@Module({
  imports: [AuthModule],
  controllers: [MinutesController],
  providers: [
    {
      provide: ProviderRegistry,
      useFactory: () => registerDefaultProviders(new ProviderRegistry()),
    },
    { provide: MINUTES_STORE, useClass: MemoryMinutesStore },
    MinutesService,
  ],
})
export class MinutesModule {}

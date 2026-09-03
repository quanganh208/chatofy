import { Module } from '@nestjs/common';
import { ProviderRegistry } from '@chatofy/ai-providers';
import { AuthModule } from '../auth/auth.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { registerDefaultProviders } from '../translate/providers/register-default-providers';
import { MINUTES_STORE } from './interfaces/minutes-store.interface';
import { PrismaMinutesStore } from './stores/prisma-minutes.store';
import { MinutesController } from './minutes.controller';
import { MinutesService } from './minutes.service';

/**
 * Minutes module.
 *
 * POST /conversations/:conversationId/minutes runs one LLM pass over a STORED
 * conversation and persists the result; GET reads it back. The summarization
 * provider is resolved by `resolveOnly` through the ProviderRegistry populated
 * from the shared composition root (register-default-providers.ts) — the same
 * registry the translate module builds, constructed here independently so the
 * two modules share the registration list without depending on each other's
 * lifecycle.
 *
 * `useClass`, not a `useFactory` reading an env var. Which backend stores
 * minutes was never a deployment decision worth making: the switch that used to
 * live here defaulted to in-memory, no deployment ever selected the durable one,
 * and the result was a feature that silently kept nothing. The TOKEN and the
 * interface survive — they are what lets a test substitute a double — but the
 * choice does not.
 *
 * `ConversationsModule` is imported for `CONVERSATION_STORE`: generation reads
 * the stored turns rather than being handed them, and it needs the same
 * owner-scoped resolution the history routes use rather than a second copy of
 * it.
 */
@Module({
  imports: [AuthModule, ConversationsModule],
  controllers: [MinutesController],
  providers: [
    {
      provide: ProviderRegistry,
      useFactory: () => registerDefaultProviders(new ProviderRegistry()),
    },
    { provide: MINUTES_STORE, useClass: PrismaMinutesStore },
    MinutesService,
  ],
})
export class MinutesModule {}

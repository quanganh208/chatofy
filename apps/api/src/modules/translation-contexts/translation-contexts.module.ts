import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TRANSLATION_CONTEXT_STORE } from './interfaces/translation-context-store.interface';
import { PrismaTranslationContextStore } from './stores/prisma-translation-context.store';
import { TranslationContextsController } from './translation-contexts.controller';
import { TranslationContextsService } from './translation-contexts.service';

/**
 * The AI Context library — what the translator is told about a kind of
 * conversation.
 *
 * `useClass`, not a `useFactory` reading an env var, following
 * `ConversationsModule`: which backend stores a context is not a deployment
 * choice. A switch there is what made minutes silently non-durable by default,
 * and the token plus the interface is already everything a test needs to
 * substitute a double.
 *
 * `TRANSLATION_CONTEXT_STORE` is deliberately NOT exported. Nothing else injects
 * it: the selected context is resolved into hints by the CLIENT and arrives on
 * `client.session.start`, because that event fires once per TURN rather than
 * once per conversation — so the translate path never looks a context id up.
 */
@Module({
  imports: [AuthModule],
  controllers: [TranslationContextsController],
  providers: [
    TranslationContextsService,
    {
      provide: TRANSLATION_CONTEXT_STORE,
      useClass: PrismaTranslationContextStore,
    },
  ],
})
export class TranslationContextsModule {}

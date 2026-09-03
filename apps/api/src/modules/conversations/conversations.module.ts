import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CONVERSATION_STORE } from './interfaces/conversation-store.interface';
import { PrismaConversationStore } from './stores/prisma-conversation.store';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * Conversation history — the API's transcript.
 *
 * `useClass`, not a `useFactory` reading an env var: which backend stores a
 * conversation is not a deployment choice. A switch there is what made minutes
 * silently non-durable by default, and the token plus the interface is already
 * everything a test needs to substitute a double.
 *
 * `CONVERSATION_STORE` is EXPORTED, following `UsersModule`: the minutes module
 * generates from stored turns and injects this store directly rather than
 * reaching for Prisma itself.
 */
@Module({
  imports: [AuthModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    { provide: CONVERSATION_STORE, useClass: PrismaConversationStore },
  ],
  exports: [CONVERSATION_STORE],
})
export class ConversationsModule {}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Conversation,
  ConversationListResponse,
  ConversationSummary,
  SaveConversationRequest,
} from '@chatofy/types';
import {
  CONVERSATION_STORE,
  type ConversationStore,
  type ListConversationsQuery,
} from './interfaces/conversation-store.interface';

/**
 * The caller's conversation history.
 *
 * `ownerId` is the first argument of every method and is always the verified
 * token's subject — the controller never passes a path or body value into it.
 * A conversation the caller does not own resolves to null in the store and
 * raises the SAME NotFoundException as one that was never written, so the reply
 * says nothing about whether another user holds that id.
 */
@Injectable()
export class ConversationsService {
  constructor(
    @Inject(CONVERSATION_STORE) private readonly store: ConversationStore,
  ) {}

  /** Create or fully replace the caller's conversation under this id. */
  save(
    ownerId: string,
    conversationId: string,
    body: SaveConversationRequest,
  ): Promise<ConversationSummary> {
    return this.store.save(ownerId, conversationId, {
      direction: body.direction,
      startedAt: body.startedAt,
      endedAt: body.endedAt,
      turns: body.turns,
    });
  }

  async get(ownerId: string, conversationId: string): Promise<Conversation> {
    const conversation = await this.store.get(ownerId, conversationId);
    if (!conversation) throw notFound(conversationId);
    return conversation;
  }

  list(
    ownerId: string,
    query: ListConversationsQuery,
  ): Promise<ConversationListResponse> {
    return this.store.list(ownerId, query);
  }

  async remove(ownerId: string, conversationId: string): Promise<void> {
    if (!(await this.store.remove(ownerId, conversationId))) {
      throw notFound(conversationId);
    }
  }
}

/**
 * One message for both causes. A distinct "not yours" would confirm the id
 * exists somewhere, which is exactly what the owner scoping is preventing.
 */
function notFound(conversationId: string): NotFoundException {
  return new NotFoundException(`no conversation ${conversationId}`);
}

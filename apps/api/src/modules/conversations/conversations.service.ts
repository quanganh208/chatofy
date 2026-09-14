import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type {
  Conversation,
  ConversationListResponse,
  ConversationSummary,
  SaveConversationRequest,
} from '@chatofy/types';
import {
  CONVERSATION_AUDIO_STORAGE,
  ConversationAudioUnavailableError,
  type ConversationAudioObject,
  type ConversationAudioStorage,
} from '../storage/interfaces/conversation-audio-storage.interface';
import {
  buildConversationAudioKey,
  sniffConversationAudio,
} from '../storage/conversation-audio';
import {
  CONVERSATION_STORE,
  type ConversationStore,
  type ListConversationsQuery,
} from './interfaces/conversation-store.interface';

/**
 * The bytes are not a container this API will store.
 *
 * A Nest exception rather than a plain Error translated at the boundary, unlike
 * the storage-outage case below. There is no ambiguity to resolve here: 415 is
 * the answer whatever the caller is doing, and `AllExceptionsFilter` only blanks
 * 5xx messages, so this one survives to tell the client that relabelling the
 * request will not help.
 */
class UnsupportedConversationAudioError extends UnsupportedMediaTypeException {
  constructor() {
    super('Recording must be WebM or MP4 audio');
  }
}

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
    @Inject(CONVERSATION_AUDIO_STORAGE)
    private readonly audio: ConversationAudioStorage,
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

  /**
   * Store this conversation's recording and point the row at it.
   *
   * The ORDER is: sniff, then resolve the key, then write the object, then write
   * the columns. A row that names an object which was never stored would render a
   * player that 404s; the reverse — bytes with no row — is invisible and
   * collectable by prefix.
   *
   * The key is minted once and then REUSED. A retry reads the existing
   * `audioKey` and overwrites the same object, because a fresh random key per
   * attempt would leave the first attempt's bytes in the bucket with nothing
   * pointing at them.
   */
  async setAudio(
    ownerId: string,
    conversationId: string,
    bytes: Buffer,
    timing: { offsetMs: number; durationMs: number },
  ): Promise<void> {
    // Before anything is sniffed or stored: an unconfigured deployment should
    // refuse without doing the work, and `enabled` is the cheap question.
    if (!this.audio.enabled) {
      throw new ConflictException('Recording storage is not configured');
    }

    // A Content-Type the raw parser does not claim — `application/octet-stream`
    // is the realistic client mistake — leaves `req.body` UNDEFINED rather than
    // empty: body-parser does not pre-initialise it, and the global validation
    // pipe passes a non-Zod metatype through untouched. Without this guard the
    // sniff dereferences `undefined.length` and the caller gets a 500 whose
    // message the exception filter then blanks. 415 is the documented answer and
    // it is the true one: those bytes are not a container this API stores.
    if (!Buffer.isBuffer(bytes)) throw new UnsupportedConversationAudioError();

    const type = sniffConversationAudio(bytes);
    if (!type) throw new UnsupportedConversationAudioError();

    // Resolving the key doubles as the ownership check, and it runs BEFORE the
    // object is written: a foreign id must not be able to put bytes in the bucket
    // even though it could never read the row back.
    const existing = await this.store.findAudioKey(ownerId, conversationId);
    if (
      existing === null &&
      !(await this.hasConversation(ownerId, conversationId))
    ) {
      throw notFound(conversationId);
    }
    const key = existing ?? buildConversationAudioKey(ownerId, type);

    await this.storeAudio(key, bytes, type.mime);

    if (
      !(await this.store.setAudio(ownerId, conversationId, {
        key,
        offsetMs: timing.offsetMs,
        durationMs: timing.durationMs,
      }))
    ) {
      // The row went away between the ownership check and this write — the user
      // deleted the conversation from another tab while the upload was in
      // flight. The object is already in the bucket with nothing pointing at it,
      // and on a PUBLIC-READ bucket that is not merely untidy: it is a recording
      // of a private conversation, reachable by URL, that survives the delete the
      // user asked for and that no later delete will ever find.
      //
      // Best-effort because the 404 is the honest answer either way; a failure to
      // clean up must not be reported as "your conversation exists".
      await this.audio.delete(key).catch(() => undefined);
      throw notFound(conversationId);
    }
  }

  /** Open this conversation's recording for streaming, for its owner only. */
  async getAudio(
    ownerId: string,
    conversationId: string,
  ): Promise<ConversationAudioObject> {
    const key = await this.store.findAudioKey(ownerId, conversationId);
    // A foreign id, an absent conversation and one with no recording all answer
    // identically — the same rule the rest of this service follows, and here it
    // also keeps "that conversation exists but has no audio" from being a signal.
    if (!key) throw notFound(conversationId);

    if (!this.audio.enabled) {
      throw new ConflictException('Recording storage is not configured');
    }

    let object: ConversationAudioObject | null;
    try {
      object = await this.audio.get(key);
    } catch (err) {
      throw asConflict(err);
    }
    if (!object) throw notFound(conversationId);
    return object;
  }

  /**
   * Remove the conversation, and its recording FIRST.
   *
   * The object goes before the row, which is the avatar route's order and the one
   * that cannot orphan bytes nobody can reach again: if the delete fails, the row
   * survives and still names the key, so a retry can finish the job. Deleting the
   * row first would lose the only pointer to an object that stays reachable by
   * URL on a public-read bucket.
   *
   * A storage failure therefore leaves BOTH in place and raises, rather than
   * reporting a removal that did not happen.
   */
  async remove(ownerId: string, conversationId: string): Promise<void> {
    const key = await this.store.findAudioKey(ownerId, conversationId);
    if (key) {
      try {
        await this.audio.delete(key);
      } catch (err) {
        throw asConflict(err);
      }
    }
    if (!(await this.store.remove(ownerId, conversationId))) {
      throw notFound(conversationId);
    }
  }

  /** Whether the caller owns a conversation under this id at all. */
  private async hasConversation(
    ownerId: string,
    conversationId: string,
  ): Promise<boolean> {
    return (await this.store.get(ownerId, conversationId)) !== null;
  }

  private async storeAudio(
    key: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await this.audio.put(key, bytes, contentType);
    } catch (err) {
      throw asConflict(err);
    }
  }
}

/**
 * A storage outage, as a status whose MESSAGE survives.
 *
 * `AllExceptionsFilter` replaces every 5xx message with 'Internal server error',
 * so an outage reported as a 5xx is byte-identical to a crash and tells the
 * caller nothing they can act on. 409 is what the avatar routes already use for
 * exactly this, and the client reads it as terminal rather than retrying forever.
 */
function asConflict(err: unknown): Error {
  if (err instanceof ConversationAudioUnavailableError) {
    return new ConflictException(err.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * One message for both causes. A distinct "not yours" would confirm the id
 * exists somewhere, which is exactly what the owner scoping is preventing.
 */
function notFound(conversationId: string): NotFoundException {
  return new NotFoundException(`no conversation ${conversationId}`);
}

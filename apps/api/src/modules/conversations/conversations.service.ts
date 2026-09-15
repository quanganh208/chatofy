import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(ConversationsService.name);

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
   * The ORDER is: sniff, then CLAIM the key, then write the object, then write
   * the timing columns. A row that names an object which was never stored would
   * render a player that 404s; the reverse — bytes with no row — is invisible
   * and collectable by prefix.
   *
   * The key is claimed ATOMICALLY rather than read-then-written. Two
   * overlapping FIRST uploads for one conversation each mint their own
   * candidate key, but only one `claimAudioKey` call can win the conditional
   * update behind it; the loser reads back the winner's key instead, so both
   * requests store the SAME object. A read-then-write pair — the shape this
   * used before — left a window where both requests could read "no key yet"
   * and each proceed to store its own object, stranding one of them with
   * nothing pointing at it on a PUBLIC-READ bucket that no later delete would
   * ever find.
   *
   * A retry after the key is claimed overwrites the same object for a related
   * reason: a fresh random key per attempt would leave the first attempt's
   * bytes in the bucket with nothing pointing at them.
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

    // Claiming the key doubles as the ownership check, and it runs BEFORE the
    // object is written: a foreign id must not be able to put bytes in the
    // bucket even though it could never read the row back. Null means the
    // caller has no such row — the candidate is discarded unused in that case.
    const key = await this.store.claimAudioKey(
      ownerId,
      conversationId,
      buildConversationAudioKey(ownerId, type),
    );
    if (key === null) throw notFound(conversationId);

    await this.storeAudio(key, bytes, type.mime);

    if (
      !(await this.store.setAudio(ownerId, conversationId, {
        key,
        offsetMs: timing.offsetMs,
        durationMs: timing.durationMs,
      }))
    ) {
      // The row went away between the claim and this write — the user deleted
      // the conversation from another tab while the upload was in flight. The
      // object is already in the bucket with nothing pointing at it, and on a
      // PUBLIC-READ bucket that is not merely untidy: it is a recording of a
      // private conversation, reachable by URL, that survives the delete the
      // user asked for and that no later delete will ever find.
      //
      // Best-effort because the 404 is the honest answer either way; a failure
      // to clean up must not be reported as "your conversation exists". A
      // failure IS logged, though — the storage interface's own docblock names
      // a silently vanished cleanup as the one thing this route must not do,
      // and an orphan nobody can see is one nobody can remove by hand either.
      await this.audio.delete(key).catch((err) => {
        this.logger.error(
          `failed to clean up an orphaned conversation recording after its ` +
            `row was deleted mid-upload; remove it by hand: ${key} (${String(err)})`,
        );
      });
      throw notFound(conversationId);
    }
  }

  /** Open this conversation's recording for streaming, for its owner only. */
  async getAudio(
    ownerId: string,
    conversationId: string,
  ): Promise<ConversationAudioObject> {
    // Checked BEFORE the key lookup, unlike `setAudio`'s ownership-first order,
    // because this check does not depend on ownership at all: it answers 409
    // for every id — owned, foreign or absent alike — the moment storage is
    // unconfigured, so moving it first costs no distinction the caller could
    // use to learn whether an id exists. Checking it after the key lookup
    // would 404 for a row with no key even while storage is unconfigured,
    // which is what let this route drift from the documented "409 when
    // storage is unconfigured" contract.
    if (!this.audio.enabled) {
      throw new ConflictException('Recording storage is not configured');
    }

    const key = await this.store.findAudioKey(ownerId, conversationId);
    // A foreign id, an absent conversation and one with no recording all answer
    // identically — the same rule the rest of this service follows, and here it
    // also keeps "that conversation exists but has no audio" from being a signal.
    if (!key) throw notFound(conversationId);

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
   * Remove the conversation, and its recording.
   *
   * The object still goes FIRST, on the avatar route's reasoning: if storage
   * refuses, the row survives and still names the key, so the 409 this raises
   * means nothing was deleted and a retry can finish the job. Both the history
   * screen's delete control and the deployment guide read the status that way,
   * and inverting the order would have made a 409 mean "the conversation is
   * gone but its recording leaked" — a failure the caller cannot act on and a
   * retry can only answer 404.
   *
   * What the old order could NOT do was close the race, because reading the
   * key and deleting the row were two statements: an upload's claim and PUT
   * could land between them, leaving an object on a PUBLIC-READ bucket with no
   * row pointing at it and both requests reporting success.
   * `removeReturningAudioKey` closes exactly that window by deleting the row
   * and reporting the key it had as ONE statement. Its value is only
   * interesting when it differs from what was read a moment ago, which happens
   * solely when an upload claimed a key in between — and that is the one case
   * where the row is already gone, so the leftover object is cleaned up
   * best-effort and logged rather than raised. The common path never reaches
   * it.
   */
  async remove(ownerId: string, conversationId: string): Promise<void> {
    // Object first, so a storage failure leaves BOTH in place and the 409 is
    // honest about nothing having been deleted.
    const known = await this.store.findAudioKey(ownerId, conversationId);
    if (known) {
      try {
        await this.audio.delete(known);
      } catch (err) {
        throw asConflict(err);
      }
    }

    const { removed, audioKey } = await this.store.removeReturningAudioKey(
      ownerId,
      conversationId,
    );
    if (!removed) throw notFound(conversationId);

    // A key that appeared between the read above and the row delete: an upload
    // raced this request. The row is gone either way, so a failure here cannot
    // be reported as "your conversation still exists" — it is an orphan on a
    // public-read bucket, which is worth a loud log and nothing else.
    if (audioKey && audioKey !== known) {
      await this.audio.delete(audioKey).catch((err) => {
        this.logger.error(
          `orphaned conversation recording after an upload raced its own ` +
            `conversation's deletion; remove it by hand: ${audioKey} (${String(err)})`,
        );
      });
    }
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

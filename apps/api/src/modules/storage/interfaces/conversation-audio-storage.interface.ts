import type { Readable } from 'node:stream';

/** DI injection token for the conversation-recording object store. */
export const CONVERSATION_AUDIO_STORAGE = Symbol('CONVERSATION_AUDIO_STORAGE');

/**
 * The object store is not configured, or could not be reached.
 *
 * A named error for the same reason `AvatarStorageUnavailableError` is one:
 * `all-exceptions.filter.ts` replaces every 5xx message with 'Internal server
 * error', so a storage outage reported as a 5xx is byte-identical to a crash and
 * tells the caller nothing they can act on. The mapping to a 409 lives in the
 * service; this layer describes storage and gains no Nest imports.
 */
export class ConversationAudioUnavailableError extends Error {
  constructor(message = 'Conversation audio storage is not configured') {
    super(message);
    this.name = 'ConversationAudioUnavailableError';
  }
}

/** One stored recording, on its way back to its owner. */
export interface ConversationAudioObject {
  body: Readable;
  contentType: string;
  contentLength: number;
}

/**
 * Where conversation recordings live.
 *
 * One seam with two implementations chosen at module construction, mirroring
 * `AvatarStorage` / `DisabledAvatarStorage`: a deployment with no R2 credentials
 * still boots, and the routes report themselves unavailable rather than stopping
 * the process.
 *
 * **A separate interface rather than a `get` bolted onto `AvatarStorage`**, and
 * the reason is not symmetry. Avatars are never read back by the API — the
 * browser fetches them from the public domain — so a `get` there would be dead
 * code on the login path. And avatars need cache-control and a content hash,
 * which a recording served `no-store` through an owner-scoped route does not.
 * One shared interface would leave each implementation carrying the other's
 * unused half.
 */
export interface ConversationAudioStorage {
  /**
   * Whether a write could succeed at all. Read BEFORE a payload is sniffed or
   * buffered, so an unconfigured deployment refuses an upload without doing the
   * work first.
   */
  readonly enabled: boolean;
  /** Stores the bytes under `key`, replacing whatever was there. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /**
   * Opens the object for streaming, or resolves null when it is not there.
   *
   * A stream rather than a Buffer: a recording is up to 32 MB and holding one
   * per concurrent listener would put the download path's memory bound on the
   * same footing as the upload path's, for no benefit — the bytes are going
   * straight out over a socket.
   */
  get(key: string): Promise<ConversationAudioObject | null>;
  /**
   * Removes the object. Resolves when it is gone or was already gone; REJECTS on
   * any other failure.
   *
   * Not best-effort, and not silent when storage is disabled — the same rule
   * `AvatarStorage.delete` states, and it binds harder here. The bucket is
   * public-read, so a delete that quietly does nothing leaves a RECORDING of a
   * private conversation reachable by URL after its owner asked for it to be
   * removed, and the owner was told it succeeded. A retryable failure is the
   * better answer.
   */
  delete(key: string): Promise<void>;
}

/** DI injection token for the avatar object store. */
export const AVATAR_STORAGE = Symbol('AVATAR_STORAGE');

/**
 * The object store is not configured, or could not be reached.
 *
 * A named error rather than a raw failure so the HTTP layer can map it to a
 * status whose MESSAGE survives: `all-exceptions.filter.ts` replaces every 5xx
 * message with 'Internal server error', so a storage outage reported as a 5xx is
 * byte-identical to a crash and tells the user nothing they can act on. The
 * mapping lives in AuthService — this layer describes storage and gains no Nest
 * imports, matching `UserAlreadyExistsError` in the user repository.
 */
export class AvatarStorageUnavailableError extends Error {
  constructor(message = 'Avatar storage is not configured') {
    super(message);
    this.name = 'AvatarStorageUnavailableError';
  }
}

/**
 * Where avatar bytes live.
 *
 * One seam with two implementations chosen at module construction, mirroring
 * `MailSender` / `NoopMailSender`: a deployment with no R2 credentials still
 * boots, and the feature reports itself unavailable at the endpoint rather than
 * stopping the process.
 */
export interface AvatarStorage {
  /**
   * Whether a write could succeed at all. Read BEFORE decoding a payload, so an
   * unconfigured deployment refuses an upload without buffering it first.
   */
  readonly enabled: boolean;
  /** Stores the bytes under `key`, replacing whatever was there. */
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /**
   * Removes the object. Resolves when the object is gone or was already gone;
   * REJECTS on any other failure.
   *
   * Not best-effort, and not silent when storage is disabled: the bucket is
   * public-read, so a delete that quietly does nothing leaves a photograph
   * published after its owner asked for it to be taken down — and the owner was
   * told it succeeded. A retryable failure is the better answer.
   */
  delete(key: string): Promise<void>;
}

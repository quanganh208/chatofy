import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { AvatarStorage } from './interfaces/avatar-storage.interface';
import { AvatarStorageUnavailableError } from './interfaces/avatar-storage.interface';

/**
 * How long a browser or edge cache may keep an avatar.
 *
 * One hour, and deliberately NOT `immutable`. The content hash in the key
 * already makes replacement safe at any TTL — new bytes are a new URL — so the
 * case that governs this number is DELETION: a long-lived immutable entry for a
 * deletable public object means a photo the user took down keeps being served
 * long after the origin object is gone. One hour bounds that window to something
 * a person can be told about.
 */
export const AVATAR_CACHE_CONTROL = 'public, max-age=3600';

/** The complete set of values an R2 client needs. All or nothing — see getR2Config. */
export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Whether a failed delete means the object was already gone. */
function isMissingObject(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, $metadata } = err as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return name === 'NoSuchKey' || $metadata?.httpStatusCode === 404;
}

/** Cloudflare R2 over its S3-compatible API. */
export class R2AvatarStorage implements AvatarStorage {
  readonly enabled = true;
  private readonly logger = new Logger(R2AvatarStorage.name);
  private readonly client: S3Client;

  constructor(private readonly config: R2Config) {
    this.client = new S3Client({
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      // R2 has no regions; the S3 client still requires the field.
      region: 'auto',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Bounded on purpose, and not by the SDK's defaults. `put` is awaited on
      // the LOGIN path — the Google picture import runs before the session is
      // minted — and the SDK ships `maxAttempts: 3` with backoff and NO request
      // timeout at all. A half-open endpoint would therefore stall a first
      // Google sign-in indefinitely: the importer's own 3s timeout covers the
      // fetch FROM Google, not the write to R2.
      //
      // The catch around the import stops it FAILING a login; only these stop it
      // delaying one. Two attempts rather than three, because the caller that
      // most needs an answer is the one that cares least about the result.
      maxAttempts: 2,
      requestHandler: { requestTimeout: 5000, connectionTimeout: 2000 },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: bytes,
          // The SNIFFED type, never a client's claim — see sniffAvatarImage.
          ContentType: contentType,
          CacheControl: AVATAR_CACHE_CONTROL,
        }),
      );
    } catch (err) {
      // Translated to the named error for the same reason `delete` is: the HTTP
      // layer maps it to a 4xx whose message survives the error filter, and the
      // raw S3 error would otherwise surface as an indistinguishable 500.
      this.logger.warn(
        `Failed to store avatar object: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AvatarStorageUnavailableError(
        'Could not reach avatar storage — try again',
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch (err) {
      // An object that is already gone is the state the caller asked for.
      // Anything else — a permission failure, an unreachable endpoint — must
      // reach the caller: a removal that reports success while the bytes stay
      // published is the one outcome this method exists to prevent.
      if (isMissingObject(err)) return;
      // Logged WITHOUT the error object's request context, which can carry the
      // signed authorization header. The message is what a reviewer needs.
      this.logger.warn(
        `Failed to delete avatar object: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new AvatarStorageUnavailableError(
        'Could not reach avatar storage — try again',
      );
    }
  }
}

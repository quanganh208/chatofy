import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type {
  ConversationAudioObject,
  ConversationAudioStorage,
} from './interfaces/conversation-audio-storage.interface';
import { ConversationAudioUnavailableError } from './interfaces/conversation-audio-storage.interface';
import type { R2Config } from './r2-avatar-storage';

/**
 * How long a browser or edge cache may keep a recording: not at all.
 *
 * `no-store`, and `private` so no shared cache holds it either. The avatar's one
 * hour exists because a public photograph is meant to be cached; a recording of a
 * conversation is served through an owner-scoped route, and a cached copy is one
 * that outlives the authorization that produced it.
 */
export const CONVERSATION_AUDIO_CACHE_CONTROL = 'private, no-store';

/**
 * The upload and download deadline, in milliseconds.
 *
 * **Deliberately not the avatar client's 5s, and this is why the two clients are
 * not one extracted helper.** `R2AvatarStorage` is bounded for the LOGIN path,
 * where the Google picture import blocks a first sign-in and "the caller that
 * most needs an answer is the one that cares least about the result". Nothing
 * about that reasoning transfers: a recording is up to 32 MB, and 5 seconds is
 * less than a 32 MB body takes on any ordinary home upstream. Sharing the avatar
 * posture would have made every long conversation fail to upload while every
 * short one worked — a defect that looks like flakiness.
 *
 * 120 seconds is roughly 32 MB at 2 Mbit/s upstream, with headroom. It bounds a
 * wedged endpoint without cutting a slow-but-working transfer.
 */
const CONVERSATION_AUDIO_REQUEST_TIMEOUT_MS = 120_000;

/** Whether a failed request means the object was already gone. */
function isMissingObject(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { name, $metadata } = err as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    $metadata?.httpStatusCode === 404
  );
}

/** Conversation recordings on Cloudflare R2, over its S3-compatible API. */
export class R2ConversationAudioStorage implements ConversationAudioStorage {
  readonly enabled = true;
  private readonly logger = new Logger(R2ConversationAudioStorage.name);
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
      // One retry, not the SDK's three: a 32 MB body is re-sent in full on each
      // attempt, so a third try costs another 32 MB uphill for a failure mode
      // the second already told us about.
      maxAttempts: 2,
      requestHandler: {
        requestTimeout: CONVERSATION_AUDIO_REQUEST_TIMEOUT_MS,
        connectionTimeout: 5_000,
      },
    });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          Body: bytes,
          // The SNIFFED type, never the client's declared header — see
          // `sniffConversationAudio`. This is what the download route hands back,
          // so a payload that is not audio cannot be served as whatever its
          // uploader named it.
          ContentType: contentType,
          CacheControl: CONVERSATION_AUDIO_CACHE_CONTROL,
        }),
      );
    } catch (err) {
      // Translated to the named error so the HTTP layer can map it to a 409 whose
      // message survives `AllExceptionsFilter`'s 5xx blanking. The raw S3 error
      // would surface as an indistinguishable 500.
      this.logger.warn(
        `Failed to store conversation audio: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new ConversationAudioUnavailableError(
        'Could not reach recording storage — try again',
      );
    }
  }

  async get(key: string): Promise<ConversationAudioObject | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!response.Body) return null;
      return {
        // In the Node runtime the SDK's streaming body IS a Readable; the union
        // in its type covers the browser build, which this process is not.
        body: response.Body as Readable,
        // The stored type, falling back only if the object predates it.
        contentType: response.ContentType ?? 'application/octet-stream',
        contentLength: response.ContentLength ?? 0,
      };
    } catch (err) {
      // A missing object is not an error here: the row may point at a key that
      // was removed out of band, and the route answers that as a 404 rather than
      // as an outage the caller could retry.
      if (isMissingObject(err)) return null;
      this.logger.warn(
        `Failed to read conversation audio: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new ConversationAudioUnavailableError(
        'Could not reach recording storage — try again',
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
      // Anything else must reach the caller: this bucket is public-read, so a
      // removal that reports success while the bytes stay reachable by URL is
      // the one outcome this method exists to prevent.
      if (isMissingObject(err)) return;
      // Logged WITHOUT the error object's request context, which can carry the
      // signed authorization header.
      this.logger.warn(
        `Failed to delete conversation audio: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new ConversationAudioUnavailableError(
        'Could not reach recording storage — try again',
      );
    }
  }
}

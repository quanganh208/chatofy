import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DisabledConversationAudioStorage } from './disabled-conversation-audio-storage';
import {
  CONVERSATION_AUDIO_CACHE_CONTROL,
  R2ConversationAudioStorage,
} from './r2-conversation-audio-storage';
import { ConversationAudioUnavailableError } from './interfaces/conversation-audio-storage.interface';

const send = vi.fn<(...args: unknown[]) => unknown>();
// The command classes stay real so the assertions read genuine input shapes;
// only the client that would open a socket is replaced.
vi.mock('@aws-sdk/client-s3', async () => {
  const actual =
    await vi.importActual<typeof import('@aws-sdk/client-s3')>(
      '@aws-sdk/client-s3',
    );
  return {
    ...actual,
    S3Client: vi.fn(function () {
      return { send: (...a: unknown[]) => send(...a) };
    }),
  };
});

const CONFIG = {
  accountId: 'acct',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucket: 'chatofy',
};

const KEY = 'conversations/user-1/0123456789abcdef.webm';

describe('R2ConversationAudioStorage', () => {
  let storage: R2ConversationAudioStorage;

  beforeEach(() => {
    send.mockReset();
    (S3Client as unknown as Mock).mockClear();
    storage = new R2ConversationAudioStorage(CONFIG);
  });

  it('gives a recording far longer than the avatar deadline', () => {
    // This is the reason the two clients are NOT one extracted helper. The avatar
    // client is bounded at 5s for the login path; a 32 MB recording takes longer
    // than that on any ordinary home upstream, so sharing that posture would make
    // every long conversation fail to upload while every short one worked.
    const [options] = (S3Client as unknown as Mock).mock.calls[0] as [
      { maxAttempts?: number; requestHandler?: { requestTimeout?: number } },
    ];
    expect(options.requestHandler?.requestTimeout).toBeGreaterThanOrEqual(
      60_000,
    );
    // One retry, not three: a 32 MB body is re-sent in full on each attempt.
    expect(options.maxAttempts).toBe(2);
  });

  describe('put', () => {
    it('stores the bytes uncached, under the given type', async () => {
      send.mockResolvedValue({});
      await storage.put(KEY, Buffer.from('bytes'), 'audio/webm');

      const command = send.mock.calls[0]![0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input.Bucket).toBe('chatofy');
      expect(command.input.Key).toBe(KEY);
      expect(command.input.ContentType).toBe('audio/webm');
      // No caching at all: the route is owner-scoped, and a cached copy is one
      // that outlives the authorization that produced it.
      expect(command.input.CacheControl).toBe(CONVERSATION_AUDIO_CACHE_CONTROL);
      expect(CONVERSATION_AUDIO_CACHE_CONTROL).toContain('no-store');
    });

    it('reports an outage as the named error, not a raw S3 failure', async () => {
      send.mockRejectedValue(new Error('connection reset'));
      await expect(
        storage.put(KEY, Buffer.from('bytes'), 'audio/webm'),
      ).rejects.toBeInstanceOf(ConversationAudioUnavailableError);
    });
  });

  describe('get', () => {
    it('hands back the stream with the STORED type', async () => {
      send.mockResolvedValue({
        Body: Readable.from([Buffer.from('bytes')]),
        ContentType: 'audio/mp4',
        ContentLength: 5,
      });
      const object = await storage.get(KEY);

      expect(send.mock.calls[0]![0] as GetObjectCommand).toBeInstanceOf(
        GetObjectCommand,
      );
      // The type the object was stored with — which came from a sniff, not from
      // any client's claim — is what the download route will set.
      expect(object?.contentType).toBe('audio/mp4');
      expect(object?.contentLength).toBe(5);
    });

    it('resolves null for an object that is not there', async () => {
      // The row may point at a key removed out of band. That is a 404 for the
      // caller, not an outage they could retry.
      send.mockRejectedValue(
        Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
      );
      await expect(storage.get(KEY)).resolves.toBeNull();
    });

    it('rejects on any other failure', async () => {
      send.mockRejectedValue(new Error('permission denied'));
      await expect(storage.get(KEY)).rejects.toBeInstanceOf(
        ConversationAudioUnavailableError,
      );
    });
  });

  describe('delete', () => {
    it('removes the object', async () => {
      send.mockResolvedValue({});
      await storage.delete(KEY);
      const command = send.mock.calls[0]![0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input.Key).toBe(KEY);
    });

    it('treats an already-gone object as success', async () => {
      send.mockRejectedValue(
        Object.assign(new Error('gone'), {
          $metadata: { httpStatusCode: 404 },
        }),
      );
      await expect(storage.delete(KEY)).resolves.toBeUndefined();
    });

    it('REJECTS on anything else, because the bucket is public-read', async () => {
      // A removal that reports success while the bytes stay reachable by URL is
      // the one outcome this method exists to prevent — and on this bucket the
      // bytes really are reachable by URL.
      send.mockRejectedValue(new Error('permission denied'));
      await expect(storage.delete(KEY)).rejects.toBeInstanceOf(
        ConversationAudioUnavailableError,
      );
    });
  });
});

describe('DisabledConversationAudioStorage', () => {
  const storage = new DisabledConversationAudioStorage();

  it('reports itself unavailable before anything is buffered', () => {
    expect(storage.enabled).toBe(false);
  });

  it('throws on every method, including delete', async () => {
    // `delete` throwing is the load-bearing one: a silent no-op would report a
    // recording removed while nothing was.
    await expect(storage.put()).rejects.toBeInstanceOf(
      ConversationAudioUnavailableError,
    );
    await expect(storage.get()).rejects.toBeInstanceOf(
      ConversationAudioUnavailableError,
    );
    await expect(storage.delete()).rejects.toBeInstanceOf(
      ConversationAudioUnavailableError,
    );
  });
});

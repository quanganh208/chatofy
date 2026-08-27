import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DisabledAvatarStorage } from './disabled-avatar-storage';
import { AVATAR_CACHE_CONTROL, R2AvatarStorage } from './r2-avatar-storage';
import { AvatarStorageUnavailableError } from './interfaces/avatar-storage.interface';

const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest
      .fn()
      .mockImplementation(() => ({ send: (...a: unknown[]) => send(...a) })),
  };
});

const CONFIG = {
  accountId: 'acct',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucket: 'chatofy-avatars',
};

describe('R2AvatarStorage', () => {
  let storage: R2AvatarStorage;

  beforeEach(() => {
    send.mockReset();
    (S3Client as unknown as jest.Mock).mockClear();
    storage = new R2AvatarStorage(CONFIG);
  });

  it('points the client at this account, with no region to guess', () => {
    const [options] = (S3Client as unknown as jest.Mock).mock.calls[0] as [
      { endpoint: string; region: string },
    ];
    expect(options.endpoint).toBe('https://acct.r2.cloudflarestorage.com');
    expect(options.region).toBe('auto');
  });

  it('bounds every request, because put is awaited on the login path', () => {
    // The SDK defaults are maxAttempts 3 with backoff and NO request timeout, so
    // a half-open endpoint would stall a first Google sign-in indefinitely. The
    // importer's 3s timeout covers the fetch FROM Google, not the write to R2.
    const [options] = (S3Client as unknown as jest.Mock).mock.calls[0] as [
      { maxAttempts?: number; requestHandler?: { requestTimeout?: number } },
    ];
    expect(options.maxAttempts).toBe(2);
    expect(options.requestHandler?.requestTimeout).toBeGreaterThan(0);
  });

  describe('put', () => {
    it('stores the bytes with the given type and a one-hour, non-immutable TTL', async () => {
      send.mockResolvedValue({});
      await storage.put('avatars/u/k.webp', Buffer.from('bytes'), 'image/webp');

      const command = send.mock.calls[0]![0] as PutObjectCommand;
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'chatofy-avatars',
        Key: 'avatars/u/k.webp',
        ContentType: 'image/webp',
        CacheControl: AVATAR_CACHE_CONTROL,
      });
      // Content hashing already makes replacement safe; `immutable` on a
      // DELETABLE public object would keep serving a photo its owner removed.
      expect(AVATAR_CACHE_CONTROL).not.toContain('immutable');
    });
  });

  describe('delete', () => {
    it('issues a delete against the configured bucket', async () => {
      send.mockResolvedValue({});
      await storage.delete('avatars/u/k.webp');

      const command = send.mock.calls[0]![0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: 'chatofy-avatars',
        Key: 'avatars/u/k.webp',
      });
    });

    it('resolves when the object was already gone', async () => {
      // The state the caller asked for already holds.
      send.mockRejectedValue(
        Object.assign(new Error('not found'), { name: 'NoSuchKey' }),
      );
      await expect(storage.delete('avatars/u/k.webp')).resolves.toBeUndefined();
    });

    it('resolves on a 404 that does not name itself NoSuchKey', async () => {
      send.mockRejectedValue(
        Object.assign(new Error('nope'), {
          $metadata: { httpStatusCode: 404 },
        }),
      );
      await expect(storage.delete('avatars/u/k.webp')).resolves.toBeUndefined();
    });

    it('rejects on a permission failure rather than reporting success', async () => {
      // The property the whole removal path depends on: a delete that cannot
      // happen must not look like one that did.
      send.mockRejectedValue(
        Object.assign(new Error('AccessDenied'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        }),
      );
      await expect(storage.delete('avatars/u/k.webp')).rejects.toBeInstanceOf(
        AvatarStorageUnavailableError,
      );
    });

    it('does not put a credential in the error it raises', async () => {
      send.mockRejectedValue(
        Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' }),
      );
      const err = await storage
        .delete('k')
        .then(() => null)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).not.toContain(CONFIG.secretAccessKey);
      expect(err!.message).not.toContain(CONFIG.accessKeyId);
    });
  });
});

describe('DisabledAvatarStorage', () => {
  const storage = new DisabledAvatarStorage();

  it('reports itself unusable before anything decodes a payload', () => {
    expect(storage.enabled).toBe(false);
  });

  it('refuses a put', async () => {
    await expect(storage.put()).rejects.toBeInstanceOf(
      AvatarStorageUnavailableError,
    );
  });

  it('REJECTS a delete rather than resolving silently', async () => {
    // Succeeding here would let "remove my photo" report 200 on a deployment
    // that cannot remove anything — and the bucket is public-read.
    await expect(storage.delete()).rejects.toBeInstanceOf(
      AvatarStorageUnavailableError,
    );
  });
});

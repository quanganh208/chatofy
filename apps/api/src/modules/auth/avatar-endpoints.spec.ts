import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { GoogleTokenVerifier } from './google-token-verifier';
import type {
  UserRecord,
  UserRepository,
} from '../users/interfaces/user-repository.interface';
import { MAX_AVATAR_BYTES } from '../storage/avatar-image';
import {
  FakeAvatarStorage,
  mockUsers,
  realHasher,
  record,
  stubConfig,
} from './auth-flow.harness';

const BASE = 'https://cdn.example.com';

/** Real WebP signature bytes, which is what the sniff actually reads. */
const webpBytes = (tail = 'a') =>
  Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from(tail, 'ascii'),
  ]);
const webp = (tail = 'a') => webpBytes(tail).toString('base64');

describe('avatar endpoints', () => {
  let users: jest.Mocked<UserRepository>;
  let storage: FakeAvatarStorage;

  const build = (avatars: FakeAvatarStorage): AuthService =>
    new AuthService(
      users,
      {
        verifyToken: jest.fn(),
        getUser: jest.fn(),
        issueToken: jest.fn().mockResolvedValue('signed.jwt.value'),
      },
      { verify: jest.fn() } as unknown as jest.Mocked<GoogleTokenVerifier>,
      realHasher(),
      stubConfig(BASE),
      avatars,
    );

  /** Makes the repository behave like a row that accepts the write it is given. */
  const withRow = (over: Partial<UserRecord> = {}) => {
    let row = record(over);
    users.findById.mockImplementation(async () => row);
    users.updateAvatarKey.mockImplementation(
      async (_id, avatarKey, changedAt, expectedKey) => {
        if (
          expectedKey !== undefined &&
          (row.avatarKey ?? null) !== expectedKey
        ) {
          return null;
        }
        const { avatarKey: _drop, ...rest } = row;
        row = {
          ...rest,
          ...(avatarKey === null ? {} : { avatarKey }),
          avatarChangedAt: changedAt,
        };
        return row;
      },
    );
    return () => row;
  };

  beforeEach(() => {
    users = mockUsers();
    storage = new FakeAvatarStorage();
  });

  describe('setAvatar', () => {
    it('stores the bytes and returns a contract naming them', async () => {
      const current = withRow();
      const user = await build(storage).setAvatar('user_1', webp());

      expect(current().avatarKey).toMatch(/^avatars\/user_1\//);
      expect(user.avatarUrl).toBe(`${BASE}/${current().avatarKey}`);
      expect(storage.objects.get(current().avatarKey!)?.contentType).toBe(
        'image/webp',
      );
    });

    it('stamps avatarChangedAt, closing the Google import for this row', async () => {
      const current = withRow();
      await build(storage).setAvatar('user_1', webp());
      expect(current().avatarChangedAt).toBeInstanceOf(Date);
    });

    it('refuses a payload that is not an image, and writes nothing', async () => {
      withRow();
      await expect(
        build(storage).setAvatar(
          'user_1',
          Buffer.from('<html>').toString('base64'),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.objects.size).toBe(0);
      expect(users.updateAvatarKey.mock.calls.length).toBe(0);
    });

    it('refuses an oversized payload, and writes nothing', async () => {
      withRow();
      const huge = Buffer.concat([
        webpBytes(),
        Buffer.alloc(MAX_AVATAR_BYTES),
      ]).toString('base64');
      await expect(
        build(storage).setAvatar('user_1', huge),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.objects.size).toBe(0);
    });

    it('refuses base64 that decodes to nothing', async () => {
      // `Buffer.from(x, 'base64')` discards what it cannot parse rather than
      // throwing, so this would otherwise reach the sniff as an empty buffer.
      withRow();
      await expect(
        build(storage).setAvatar('user_1', '!!!!'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.objects.size).toBe(0);
    });

    it('returns 409 with no column write when storage is unconfigured', async () => {
      withRow();
      const disabled = new FakeAvatarStorage(false);
      await expect(
        build(disabled).setAvatar('user_1', webp()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.updateAvatarKey.mock.calls.length).toBe(0);
    });

    it('deletes the previous object when replacing', async () => {
      const current = withRow({ avatarKey: 'avatars/user_1/old.webp' });
      storage.objects.set('avatars/user_1/old.webp', {
        bytes: webpBytes('old'),
        contentType: 'image/webp',
      });

      await build(storage).setAvatar('user_1', webp('new'));

      expect(storage.objects.has('avatars/user_1/old.webp')).toBe(false);
      expect(storage.objects.has(current().avatarKey!)).toBe(true);
    });

    it('still succeeds when deleting the previous object fails', async () => {
      // Best-effort by design: the user still wants an avatar published, so a
      // leftover object is storage waste, not a takedown that silently failed.
      const current = withRow({ avatarKey: 'avatars/user_1/old.webp' });
      storage.deleteRejectsWith = new Error('AccessDenied');

      const user = await build(storage).setAvatar('user_1', webp('new'));
      expect(user.avatarUrl).toBe(`${BASE}/${current().avatarKey}`);
    });
  });

  describe('removeAvatar', () => {
    it('deletes the object and only then clears the columns', async () => {
      const current = withRow({ avatarKey: 'avatars/user_1/k.webp' });
      storage.objects.set('avatars/user_1/k.webp', {
        bytes: webpBytes(),
        contentType: 'image/webp',
      });

      const user = await build(storage).removeAvatar('user_1');

      expect(storage.objects.has('avatars/user_1/k.webp')).toBe(false);
      expect(current().avatarKey).toBeUndefined();
      expect(user.avatarUrl).toBeNull();
    });

    it('stamps avatarChangedAt so a removal is never re-imported', async () => {
      const current = withRow({ avatarKey: 'avatars/user_1/k.webp' });
      await build(storage).removeAvatar('user_1');
      expect(current().avatarChangedAt).toBeInstanceOf(Date);
    });

    it('returns 409 and leaves the columns UNCHANGED when storage is unconfigured', async () => {
      // The inversion that matters. Clearing the column here would leave a
      // public object published while the user was told it was removed.
      const current = withRow({ avatarKey: 'avatars/user_1/k.webp' });
      const disabled = new FakeAvatarStorage(false);

      await expect(
        build(disabled).removeAvatar('user_1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(current().avatarKey).toBe('avatars/user_1/k.webp');
      expect(users.updateAvatarKey.mock.calls.length).toBe(0);
    });

    it('returns 409 and leaves the columns unchanged when the delete rejects', async () => {
      const current = withRow({ avatarKey: 'avatars/user_1/k.webp' });
      storage.deleteRejectsWith = new Error('AccessDenied');

      await expect(
        build(storage).removeAvatar('user_1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(current().avatarKey).toBe('avatars/user_1/k.webp');
      expect(users.updateAvatarKey.mock.calls.length).toBe(0);
    });

    it('says the storage is unconfigured, in a message a 4xx keeps', async () => {
      withRow({ avatarKey: 'avatars/user_1/k.webp' });
      const err = await build(new FakeAvatarStorage(false))
        .removeAvatar('user_1')
        .then(() => null)
        .catch((e: ConflictException) => e);
      expect(err!.message).toContain('not configured');
    });

    it('returns 200 for a row that has no avatar, not 404', async () => {
      // The caller asked for a state that already holds.
      const current = withRow();
      const user = await build(storage).removeAvatar('user_1');
      expect(user.avatarUrl).toBeNull();
      // Nothing stamped: an unstamped row is what still permits a first import.
      expect(current().avatarChangedAt).toBeUndefined();
      expect(users.updateAvatarKey.mock.calls.length).toBe(0);
    });

    it('yields to a concurrent upload rather than orphaning its object', async () => {
      // Two tabs: this removal deleted the key it read, but by the time it went
      // to clear the column another upload had already pointed the row at a NEW
      // object. Clearing unconditionally would orphan bytes the user just chose.
      withRow({ avatarKey: 'avatars/user_1/old.webp' });
      const newer = record({
        avatarKey: 'avatars/user_1/new.webp',
        avatarChangedAt: new Date(),
      });
      users.updateAvatarKey.mockResolvedValue(null);
      users.findById
        .mockResolvedValueOnce(record({ avatarKey: 'avatars/user_1/old.webp' }))
        .mockResolvedValue(newer);

      const user = await build(storage).removeAvatar('user_1');
      expect(user.avatarUrl).toBe(`${BASE}/avatars/user_1/new.webp`);
    });
  });
});

import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthAdapter } from './jwt-auth.adapter';
import type { UsersService } from '../../users/users.service';
import type { UserRecord } from '../../users/interfaces/user-repository.interface';

const SECRET = 'a-test-secret-long-enough-for-the-schema';

function record(over: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    email: 'a@b.com',
    displayName: 'A',
    preferredLanguage: 'vi',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

describe('JwtAuthAdapter', () => {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: 60 },
  });
  let users: { findById: jest.Mock };
  let adapter: JwtAuthAdapter;

  beforeEach(() => {
    users = { findById: jest.fn() };
    adapter = new JwtAuthAdapter(jwt, users as unknown as UsersService);
  });

  it('issues a token that verifies back to the same subject', async () => {
    const token = await adapter.issueToken('user_1');
    await expect(adapter.verifyToken(token)).resolves.toMatchObject({
      sub: 'user_1',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const other = new JwtService({ secret: 'a-completely-different-secret-x' });
    const token = await other.signAsync({ sub: 'user_1' });
    await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'user_1' }, { expiresIn: '-1s' });
    await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a garbage token without throwing anything else', async () => {
    await expect(adapter.verifyToken('not-a-jwt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a well-signed token carrying no subject', async () => {
    const token = await jwt.signAsync({ role: 'admin' });
    await expect(adapter.verifyToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves a user identity for a known subject', async () => {
    users.findById.mockResolvedValue(record());
    await expect(adapter.getUser('user_1')).resolves.toEqual({
      id: 'user_1',
      email: 'a@b.com',
      displayName: 'A',
    });
  });

  it('refuses a subject whose row no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    await expect(adapter.getUser('gone')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('omits displayName rather than sending undefined for a user without one', async () => {
    users.findById.mockResolvedValue(record({ displayName: undefined }));
    await expect(adapter.getUser('user_1')).resolves.toEqual({
      id: 'user_1',
      email: 'a@b.com',
    });
  });
});

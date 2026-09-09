import { vi } from 'vitest';
import type { Mocked } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { JwtService } from '@nestjs/jwt';
import type {
  MailDispatch,
  MailSender,
} from '../mail/interfaces/mail-sender.interface';
import { AuthMailer } from './auth-mailer';
import { PasswordHasher } from './password-hasher';
import { PurposeTokenService } from './purpose-token';
import type { UserRecord } from '../users/interfaces/user-repository.interface';
import type { UserRepository } from '../users/interfaces/user-repository.interface';
import type { AvatarStorage } from '../storage/interfaces/avatar-storage.interface';
import { AvatarStorageUnavailableError } from '../storage/interfaces/avatar-storage.interface';

/**
 * The pieces all three auth flow specs build on.
 *
 * Shared rather than copied into each because the flows were split for
 * readability, not to make them disagree: a mail recorder that drains
 * differently in one spec, or a `record()` missing a column another asserts is
 * absent, would turn one behaviour into three descriptions of it.
 */
export const SECRET = 'a-test-secret-long-enough-for-the-schema';

const WEB_BASE_URL = 'http://localhost:3001';

export function record(over: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user_1',
    email: 'a@b.com',
    name: 'A',
    locale: 'en',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

/**
 * Every mail a flow dispatched.
 *
 * Sends are DETACHED — awaiting one would make response time an
 * account-existence oracle — so a test that wants to see one has to let the
 * microtask queue drain first. {@link settle} is that wait, and it is why these
 * assertions never race the code they cover.
 */
export class RecordingMailSender implements MailSender {
  readonly sent: MailDispatch[] = [];
  async send(dispatch: MailDispatch): Promise<void> {
    this.sent.push(dispatch);
  }
}

/** Lets the detached dispatch chains run to completion. */
export const settle = (): Promise<unknown> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Every method of the repository, mocked. */
export function mockUsers(): Mocked<UserRepository> {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByGoogleSub: vi.fn(),
    findCredentialsByEmail: vi.fn(),
    findAuthStateById: vi.fn(),
    findCredentialsById: vi.fn(),
    create: vi.fn(),
    linkGoogleSub: vi.fn(),
    updatePasswordHash: vi.fn(),
    updateLocale: vi.fn(),
    updateAvatarKey: vi.fn(),
  };
}

/**
 * An in-memory AvatarStorage with the two behaviours that matter recorded.
 *
 * A fake rather than a mock so a spec can assert what is actually IN the store
 * after a sequence — a replacement that deletes the wrong key, or a removal that
 * clears a column without removing bytes, is invisible to call-count assertions
 * alone.
 */
export class FakeAvatarStorage implements AvatarStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  /** Set to make the next delete fail the way an unreachable bucket would. */
  deleteRejectsWith: Error | null = null;

  constructor(readonly enabled = true) {}

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    if (!this.enabled) throw new AvatarStorageUnavailableError();
    this.objects.set(key, { bytes, contentType });
  }

  async delete(key: string): Promise<void> {
    if (!this.enabled) throw new AvatarStorageUnavailableError();
    if (this.deleteRejectsWith) throw this.deleteRejectsWith;
    this.objects.delete(key);
  }
}

/**
 * A ConfigService double returning one value for every key.
 *
 * Enough for AuthService, which reads exactly one — `R2_PUBLIC_BASE_URL`. Pass
 * undefined for the unconfigured case: `toUserContract` yields a null
 * `avatarUrl` for an unset base, and that is the default a spec should get.
 */
export function stubConfig(avatarBaseUrl?: string): ConfigService<Env, true> {
  return {
    get: () => avatarBaseUrl,
  } as unknown as ConfigService<Env, true>;
}

/**
 * A real PurposeTokenService: it is pure and dependency-free, and the token
 * derivation — the purpose infix, the hash-keyed reset, the sealed payload — is
 * exactly the part a mock would stop proving.
 */
export function realTokens(): PurposeTokenService {
  return new PurposeTokenService(new JwtService({ secret: SECRET }), {
    get: () => SECRET,
  } as unknown as ConfigService<never, true>);
}

/** A real mailer over a recording sender, so the detached hop is under test too. */
export function realMailer(mail: MailSender): AuthMailer {
  return new AuthMailer(mail, {
    get: () => WEB_BASE_URL,
  } as unknown as ConfigService<never, true>);
}

/** A real hasher: argon2 is what the timing defences are about. */
export function realHasher(): PasswordHasher {
  return new PasswordHasher();
}

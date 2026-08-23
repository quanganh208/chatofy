import type {
  CreateUserDto,
  UpdateUserDto,
  UserCredentials,
  UserRecord,
  UserRepository,
} from '../../src/modules/users/interfaces/user-repository.interface';
import { UserAlreadyExistsError } from '../../src/modules/users/interfaces/user-repository.interface';

/** What the database stores; the public shape drops `passwordHash`. */
interface Row extends UserRecord {
  passwordHash: string | null;
  googleSub: string | null;
}

/**
 * A UserRepository that keeps rows in a Map.
 *
 * Used through `overrideProvider(USER_REPOSITORY)` so the suites that only need
 * an identity get one without a database. Everything above this line — the
 * controller, AuthService, argon2, JWT issuance — is the real thing, so a token
 * minted against it is a token the running API would have minted.
 *
 * It deliberately does NOT stand in for the Postgres-backed suite. The
 * `googleSub` unique constraint and real `findUnique` semantics are exactly what
 * the Google linking policy leans on, and a Map cannot prove either.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly rows = new Map<string, Row>();
  private nextId = 1;

  private static toRecord(row: Row): UserRecord {
    const { passwordHash: _hash, googleSub: _sub, ...record } = row;
    return { ...record };
  }

  private find(predicate: (row: Row) => boolean): Row | undefined {
    for (const row of this.rows.values()) if (predicate(row)) return row;
    return undefined;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row = this.rows.get(id);
    return row ? InMemoryUserRepository.toRecord(row) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = this.find((r) => r.email === email);
    return row ? InMemoryUserRepository.toRecord(row) : null;
  }

  async findByGoogleSub(googleSub: string): Promise<UserRecord | null> {
    const row = this.find((r) => r.googleSub === googleSub);
    return row ? InMemoryUserRepository.toRecord(row) : null;
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const row = this.find((r) => r.email === email);
    if (!row) return null;
    return {
      user: InMemoryUserRepository.toRecord(row),
      passwordHash: row.passwordHash,
      googleSub: row.googleSub,
    };
  }

  async create(dto: CreateUserDto): Promise<UserRecord> {
    // The real table carries unique indexes on `email` and `googleSub`, and
    // AuthService now turns their refusal into a 409. A Map that accepted
    // duplicates would let every suite running against this double pass while
    // the deployed API answered differently — so the constraint is enforced
    // here too, and by the same error type.
    if (this.find((row) => row.email === dto.email)) {
      throw new UserAlreadyExistsError('email');
    }
    if (
      dto.googleSub !== undefined &&
      this.find((row) => row.googleSub === dto.googleSub)
    ) {
      throw new UserAlreadyExistsError('googleSub');
    }

    const now = new Date();
    const row: Row = {
      id: `mem_user_${this.nextId++}`,
      email: dto.email,
      ...(dto.displayName === undefined
        ? {}
        : { displayName: dto.displayName }),
      preferredLanguage: dto.preferredLanguage ?? 'vi',
      createdAt: now,
      updatedAt: now,
      passwordHash: dto.passwordHash ?? null,
      googleSub: dto.googleSub ?? null,
    };
    this.rows.set(row.id, row);
    return InMemoryUserRepository.toRecord(row);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserRecord> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No such user: ${id}`);
    if (dto.displayName !== undefined) row.displayName = dto.displayName;
    if (dto.preferredLanguage !== undefined) {
      row.preferredLanguage = dto.preferredLanguage;
    }
    row.updatedAt = new Date();
    return InMemoryUserRepository.toRecord(row);
  }

  async linkGoogleSub(
    id: string,
    googleSub: string,
  ): Promise<UserRecord | null> {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No such user: ${id}`);
    // Conditional, matching the Prisma implementation: a row that already
    // carries an identity is never overwritten, and null says so.
    if (row.googleSub !== null) return null;
    row.googleSub = googleSub;
    row.updatedAt = new Date();
    return InMemoryUserRepository.toRecord(row);
  }
}

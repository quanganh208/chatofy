/** DI injection token for the user repository. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

/**
 * Minimal user shape stored in the database.
 *
 * Deliberately carries NO `passwordHash`. This is the type every consumer above
 * the repository sees — UsersService, the mapper, the controllers — so a hash
 * cannot reach a response by being spread into one. Code that genuinely needs
 * the hash asks for `UserCredentials` by name.
 */
export interface UserRecord {
  id: string;
  email: string;
  displayName?: string;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A user plus the secret material only the auth flow may read.
 *
 * Two callers exist and both are inside AuthService: verifying a password at
 * login, and deciding whether a Google identity may link to an existing row.
 * The second only reads whether `passwordHash` is null — a row that never
 * proved password control is safe to link, one that did is not.
 */
export interface UserCredentials {
  user: UserRecord;
  passwordHash: string | null;
}

/** Fields accepted when creating a new user. */
export interface CreateUserDto {
  email: string;
  displayName?: string;
  preferredLanguage?: string;
  /** argon2 hash. Absent for a Google-first account that never chose a password. */
  passwordHash?: string;
  /** Google's `sub` claim, when the account was created by a Google login. */
  googleSub?: string;
}

/** Fields accepted when updating an existing user (all optional). */
export interface UpdateUserDto {
  displayName?: string;
  preferredLanguage?: string;
}

/**
 * Backend-agnostic user repository interface.
 * Default impl: PrismaUserRepository. Swap freely (e.g. in-memory for tests).
 */
export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(dto: CreateUserDto): Promise<UserRecord>;
  update(id: string, dto: UpdateUserDto): Promise<UserRecord>;

  /** Looks up a user by Google's stable subject claim. */
  findByGoogleSub(googleSub: string): Promise<UserRecord | null>;
  /** The one read that returns secret material — see UserCredentials. */
  findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  /** Attaches a Google identity to an existing row. */
  linkGoogleSub(id: string, googleSub: string): Promise<UserRecord>;
}

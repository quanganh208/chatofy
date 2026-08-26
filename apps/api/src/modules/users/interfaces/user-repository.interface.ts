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
  name?: string;
  /**
   * The language this account's MAIL is written in.
   *
   * On `UserRecord` rather than beside the hash, because unlike `passwordHash` and
   * `passwordChangedAt` this one is safe — and useful — in a response: the settings
   * screen has to be able to show what it is set to.
   *
   * A bare `string` here, matching the column. What may be WRITTEN is narrowed at the
   * HTTP boundary; a row written by a newer build must still read.
   */
  locale: string;
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
  /**
   * The Google identity already attached to this row, if any.
   *
   * Carried here rather than on `UserRecord` for the same reason the hash is:
   * only the linking policy has any business reading it, and it needs to know
   * whether the row is ALREADY linked to a different identity before it
   * overwrites one.
   */
  googleSub: string | null;
}

/**
 * The auth state read on every authenticated request and every socket upgrade.
 *
 * A type of its own rather than two more fields on `UserRecord`, for the same
 * reason `UserCredentials` is one: a widened `UserRecord` is spread into
 * responses all over this codebase, and a revocation timestamp on it would be
 * one careless mapper away from a payload. Nothing above the auth path can even
 * name this shape.
 */
export interface UserAuthState {
  id: string;
  /**
   * When this row's password last changed, or null if it never has. Compared
   * against a token's `iat` — see `JwtAuthAdapter.verifyToken`.
   */
  passwordChangedAt: Date | null;
}

/** Which unique column refused a write. */
export type UniqueUserField = 'email' | 'googleSub';

/**
 * A create lost a race to a unique index.
 *
 * Exists because checking `findByEmail` and then calling `create` is two
 * statements, and nothing holds the gap: two registrations of one address both
 * see no row and both insert. The database is the only thing that actually
 * decides, and it decides by refusing the loser.
 *
 * Thrown by the REPOSITORY rather than mapped to an HTTP status there — this
 * layer has no Nest imports and gains none here, so the seam keeps describing
 * storage while `AuthService` keeps owning what a caller is told. Every
 * implementation of `UserRepository` must raise it, including the in-memory
 * double: a test that cannot lose the race cannot prove the mapping.
 */
export class UserAlreadyExistsError extends Error {
  constructor(readonly field: UniqueUserField) {
    super(`A user with that ${field} already exists`);
    this.name = 'UserAlreadyExistsError';
  }
}

/** Fields accepted when creating a new user. */
export interface CreateUserDto {
  email: string;
  name?: string;
  /**
   * Carried from the registration request, because the row does not exist yet when
   * the verification mail is composed. Absent falls to the column default.
   */
  locale?: string;
  /** argon2 hash. Absent for a Google-first account that never chose a password. */
  passwordHash?: string;
  /** Google's `sub` claim, when the account was created by a Google login. */
  googleSub?: string;
}

/**
 * Backend-agnostic user repository interface.
 * Default impl: PrismaUserRepository. Swap freely (e.g. in-memory for tests).
 */
export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  /**
   * Inserts a new user.
   *
   * Throws {@link UserAlreadyExistsError} when a unique column already holds the
   * value — the race a preceding existence check cannot close.
   */
  create(dto: CreateUserDto): Promise<UserRecord>;

  /** Looks up a user by Google's stable subject claim. */
  findByGoogleSub(googleSub: string): Promise<UserRecord | null>;
  /** The one read that returns secret material — see UserCredentials. */
  findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  /**
   * The per-request revocation read: id and `passwordChangedAt`, nothing else.
   *
   * Narrow on purpose. This runs on every authenticated request and every socket
   * upgrade, and it returns a value that must never reach a response — so it
   * returns the two fields the check needs and cannot carry a third.
   *
   * Null means the row is gone, which the auth path treats as "no identity".
   */
  findAuthStateById(id: string): Promise<UserAuthState | null>;
  /**
   * Credentials by id rather than by email — what a redeemed reset token has.
   *
   * The token names a user id; deriving its signing key needs that row's current
   * `passwordHash`, which is what makes a reset link die the moment the password
   * changes.
   */
  findCredentialsById(id: string): Promise<UserCredentials | null>;
  /**
   * Sets a new password hash and stamps when it changed, in one write.
   *
   * One method rather than widening `UpdateUserDto`, mirroring `linkGoogleSub`:
   * `update` takes a DTO built from a request body, and a hash must never be
   * something a client can put there. The two fields move together because a
   * hash written without its timestamp is a reset that revokes nothing.
   *
   * `changedAt` is supplied by the caller from the app clock — the same clock
   * that stamps a token's `iat` — rather than defaulted here, so the comparison
   * has no skew to reason about.
   */
  updatePasswordHash(
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<UserRecord>;
  /**
   * Attaches a Google identity to a row that has none.
   *
   * Conditional on `googleSub` still being null, and returns null when it is
   * not. That is what closes the race between two logins for the same new
   * identity, which a check-then-write in the service cannot.
   */
  linkGoogleSub(id: string, googleSub: string): Promise<UserRecord | null>;
  /**
   * Changes the language this account's mail is written in.
   *
   * Its own method rather than a general `update`, for the same reason
   * `updatePasswordHash` and `linkGoogleSub` are: a DTO built from a request body
   * must not be able to name a column the caller has no business setting, and the
   * safest way to guarantee that is to have no method that would accept one.
   */
  updateLocale(id: string, locale: string): Promise<UserRecord>;
}

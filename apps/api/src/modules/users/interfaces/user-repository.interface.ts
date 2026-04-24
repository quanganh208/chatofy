/** DI injection token for the user repository. */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

/** Minimal user shape stored in the database. */
export interface UserRecord {
  id: string;
  email: string;
  displayName?: string;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields accepted when creating a new user. */
export interface CreateUserDto {
  email: string;
  displayName?: string;
  preferredLanguage?: string;
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
}

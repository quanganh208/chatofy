/**
 * Provider-agnostic user repository contract.
 * Default impl: PrismaUserRepository.
 * Swap to a different DB/ORM by binding USER_REPOSITORY to a different class.
 */

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface CreateUserInput {
  email: string;
  displayName?: string;
  preferredLanguage?: string;
}

export interface UpdateUserInput {
  displayName?: string;
  preferredLanguage?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  update(id: string, input: UpdateUserInput): Promise<UserRecord>;
}

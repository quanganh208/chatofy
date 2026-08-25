import type { User } from '@chatofy/types';
import type { UserRecord } from '../interfaces/user-repository.interface';

/**
 * Maps the repository's internal UserRecord to the public `User` wire contract.
 *
 * The return type is pinned to `User`, so the compiler rejects any drift between
 * the record and the contract. Fields are listed explicitly (never `...row`) so
 * internal columns (e.g. passwordChangedAt, updatedAt) can never leak into the
 * client-facing payload.
 *
 * `UserRecord.name` is `string | undefined` (Prisma `String?`); the
 * contract uses `string | null`, so it is normalised at this boundary.
 */
export function toUserContract(row: UserRecord): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    locale: row.locale,
    createdAt: row.createdAt.toISOString(),
  };
}

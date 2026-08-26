import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateUserDto,
  UniqueUserField,
  UserAuthState,
  UserAlreadyExistsError,
  UserCredentials,
  UserRecord,
  UserRepository,
} from '../interfaces/user-repository.interface';

/**
 * The columns every read returns. Listed explicitly rather than taken as the
 * default row, so `passwordHash` is absent by construction: adding a secret
 * column to the schema later cannot widen these results by accident.
 */
const RECORD_SELECT = {
  id: true,
  email: true,
  name: true,
  locale: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The shape RECORD_SELECT produces — Prisma renders nullable columns as null. */
type SelectedRow = {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * `UserRecord.name` is optional, the column is nullable. Normalising here
 * rather than at the response mapper keeps one meaning of "absent" above the
 * repository.
 */
function toRecord(row: SelectedRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    ...(row.name === null ? {} : { name: row.name }),
    locale: row.locale,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Every string a P2002 might use to name the index it refused.
 *
 * Prisma has MOVED this, so both homes are read. Through v6 it was
 * `meta.target` — a column list, or an index name. Under v7's driver adapters
 * it is `meta.driverAdapterError.cause`, where `constraint.fields` carries
 * Postgres's quoted identifiers (`"googleSub"`, quotes included) and
 * `originalMessage` names the index (`User_googleSub_key`). Collecting all of
 * them means a match survives the next move; `auth.db-e2e-spec.ts` is what
 * proves which one actually arrives, because no mock can.
 */
function constraintNames(meta: unknown): string[] {
  if (typeof meta !== 'object' || meta === null) return [];
  const names: string[] = [];

  const { target, driverAdapterError } = meta as {
    target?: unknown;
    driverAdapterError?: unknown;
  };
  if (Array.isArray(target)) names.push(...target.map(String));
  else if (typeof target === 'string') names.push(target);

  const cause = (driverAdapterError as { cause?: unknown } | undefined)?.cause;
  if (typeof cause === 'object' && cause !== null) {
    const { constraint, originalMessage } = cause as {
      constraint?: unknown;
      originalMessage?: unknown;
    };
    const fields = (constraint as { fields?: unknown } | undefined)?.fields;
    if (Array.isArray(fields)) names.push(...fields.map(String));
    if (typeof originalMessage === 'string') names.push(originalMessage);
  }

  return names;
}

/**
 * Reads a unique-constraint refusal out of a Prisma error, or returns null.
 *
 * Matched STRUCTURALLY rather than with `instanceof
 * Prisma.PrismaClientKnownRequestError`: the check is one field, and importing
 * the generated client's error class here would tie this file to a build
 * artifact that `prisma:generate` has to have produced before it type-checks.
 *
 * `User` has exactly two unique columns besides its id, so anything that is not
 * googleSub is the email — stated as the fallback rather than a third case,
 * because a P2002 this cannot name is still a duplicate and must not escape as
 * a 500.
 */
function uniqueViolationField(err: unknown): UniqueUserField | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, meta } = err as { code?: unknown; meta?: unknown };
  if (code !== 'P2002') return null;

  return constraintNames(meta).some((name) => name.includes('googleSub'))
    ? 'googleSub'
    : 'email';
}

/**
 * Prisma-backed user repository.
 *
 * Every method selects RECORD_SELECT except findCredentialsByEmail, which is the
 * single sanctioned reader of `passwordHash`.
 * PrismaService is injected via the global PrismaModule.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: RECORD_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { email },
      select: RECORD_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findByGoogleSub(googleSub: string): Promise<UserRecord | null> {
    const row = await this.prisma.user.findUnique({
      where: { googleSub },
      select: RECORD_SELECT,
    });
    return row ? toRecord(row) : null;
  }

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const row = await this.prisma.user.findUnique({
      where: { email },
      select: { ...RECORD_SELECT, passwordHash: true, googleSub: true },
    });
    if (!row) return null;
    const { passwordHash, googleSub, ...rest } = row;
    return { user: toRecord(rest), passwordHash, googleSub };
  }

  async findAuthStateById(id: string): Promise<UserAuthState | null> {
    // Not RECORD_SELECT: this read runs on every authenticated request and
    // every socket upgrade, and the two columns it names are the whole answer.
    // Selecting the row would carry fields the caller has no use for into the
    // hottest read in the auth path.
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, passwordChangedAt: true },
    });
  }

  async findCredentialsById(id: string): Promise<UserCredentials | null> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: { ...RECORD_SELECT, passwordHash: true, googleSub: true },
    });
    if (!row) return null;
    const { passwordHash, googleSub, ...rest } = row;
    return { user: toRecord(rest), passwordHash, googleSub };
  }

  async updatePasswordHash(
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<UserRecord> {
    const row = await this.prisma.user.update({
      where: { id },
      // Both columns in one statement. A hash written without its timestamp is a
      // password change that revokes nothing, and the gap between two writes is
      // exactly the window an attacker's live token would survive.
      data: { passwordHash, passwordChangedAt: changedAt },
      select: RECORD_SELECT,
    });
    return toRecord(row);
  }

  async create(dto: CreateUserDto): Promise<UserRecord> {
    try {
      const row = await this.prisma.user.create({
        data: {
          email: dto.email,
          name: dto.name ?? null,
          passwordHash: dto.passwordHash ?? null,
          googleSub: dto.googleSub ?? null,
          // Undefined, not null: the column is NOT NULL with a default, and `null`
          // would be an explicit write of an illegal value rather than a fall-through.
          ...(dto.locale === undefined ? {} : { locale: dto.locale }),
        },
        select: RECORD_SELECT,
      });
      return toRecord(row);
    } catch (err) {
      // Only a duplicate is translated. Anything else — a dropped connection, a
      // column that does not exist — is a real fault and must keep its identity
      // rather than being reported to a caller as "already registered".
      const field = uniqueViolationField(err);
      if (field) throw new UserAlreadyExistsError(field);
      throw err;
    }
  }

  async updateLocale(id: string, locale: string): Promise<UserRecord> {
    const row = await this.prisma.user.update({
      where: { id },
      data: { locale },
      select: RECORD_SELECT,
    });
    return toRecord(row);
  }

  async linkGoogleSub(
    id: string,
    googleSub: string,
  ): Promise<UserRecord | null> {
    // `updateMany` so `googleSub: null` can be part of the WHERE — `update`
    // only matches on unique fields. The count is the answer: a row that
    // already carries an identity is not matched and not overwritten, which is
    // the check and the write in one statement and therefore not racy.
    const { count } = await this.prisma.user.updateMany({
      where: { id, googleSub: null },
      data: { googleSub },
    });
    if (count === 0) return null;
    return this.findById(id);
  }
}

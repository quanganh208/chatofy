import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateUserDto,
  UpdateUserDto,
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
  displayName: true,
  preferredLanguage: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The shape RECORD_SELECT produces — Prisma renders nullable columns as null. */
type SelectedRow = {
  id: string;
  email: string;
  displayName: string | null;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * `UserRecord.displayName` is optional, the column is nullable. Normalising here
 * rather than at the response mapper keeps one meaning of "absent" above the
 * repository.
 */
function toRecord(row: SelectedRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    ...(row.displayName === null ? {} : { displayName: row.displayName }),
    preferredLanguage: row.preferredLanguage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
      select: { ...RECORD_SELECT, passwordHash: true },
    });
    if (!row) return null;
    const { passwordHash, ...rest } = row;
    return { user: toRecord(rest), passwordHash };
  }

  async create(dto: CreateUserDto): Promise<UserRecord> {
    const row = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName ?? null,
        passwordHash: dto.passwordHash ?? null,
        googleSub: dto.googleSub ?? null,
        // Omitted rather than defaulted here: the column's own default is the
        // single place that decides what a new user's language is.
        ...(dto.preferredLanguage === undefined
          ? {}
          : { preferredLanguage: dto.preferredLanguage }),
      },
      select: RECORD_SELECT,
    });
    return toRecord(row);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserRecord> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.displayName === undefined
          ? {}
          : { displayName: dto.displayName }),
        ...(dto.preferredLanguage === undefined
          ? {}
          : { preferredLanguage: dto.preferredLanguage }),
      },
      select: RECORD_SELECT,
    });
    return toRecord(row);
  }

  async linkGoogleSub(id: string, googleSub: string): Promise<UserRecord> {
    const row = await this.prisma.user.update({
      where: { id },
      data: { googleSub },
      select: RECORD_SELECT,
    });
    return toRecord(row);
  }
}

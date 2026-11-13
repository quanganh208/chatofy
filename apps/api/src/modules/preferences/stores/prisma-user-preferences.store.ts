import { Injectable } from '@nestjs/common';
import type { UserPreferences } from '@chatofy/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  StoredPreferences,
  UserPreferencesStore,
} from '../interfaces/user-preferences-store.interface';

/**
 * The preferences document in Postgres: one `UserPreferences` row per account,
 * absent until the account first changes something or resets.
 */
@Injectable()
export class PrismaUserPreferencesStore implements UserPreferencesStore {
  constructor(private readonly prisma: PrismaService) {}

  async read(userId: string): Promise<StoredPreferences | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        locale: true,
        preferences: { select: { data: true, updatedAt: true } },
      },
    });
    if (!user) return null;
    return {
      locale: user.locale,
      data: user.preferences?.data ?? null,
      updatedAt: user.preferences?.updatedAt ?? null,
    };
  }

  /**
   * Read-merge-write under a lock on the account's `User` row.
   *
   * ## Why the USER row is locked, not the preferences row
   *
   * A PATCH is a merge over what is stored, so two devices patching different
   * fields at once must not both read the same base: the second write would
   * replace the first's field with the stale value it read. A row lock makes the
   * second transaction wait, and at READ COMMITTED its read after the wait is a
   * fresh one that sees the first's commit.
   *
   * Locking the `UserPreferences` row itself would leave the most likely race
   * open: before an account's first write there IS no row, `SELECT … FOR UPDATE`
   * over nothing locks nothing, and two first PATCHes would both merge over the
   * defaults. The `User` row exists for every authenticated caller, so locking it
   * serialises the first write exactly like every later one, with no
   * insert-conflict retry and no advisory-lock key space to claim.
   *
   * `FOR NO KEY UPDATE` rather than `FOR UPDATE`: it conflicts with itself, which
   * is all the serialisation needs, but not with the `FOR KEY SHARE` a foreign
   * key check takes — so a conversation, context or ledger row being inserted
   * for this user elsewhere does not queue behind a preferences save. The
   * upsert's own foreign key check is in this transaction and does not wait.
   *
   * Taking the lock also reads `locale` (the defaults' input) and proves the
   * user still exists, in the same statement.
   */
  async update(
    userId: string,
    next: (current: StoredPreferences) => UserPreferences,
  ): Promise<StoredPreferences | null> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ locale: string }[]>`
        SELECT "locale" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
      if (!locked) return null;

      const row = await tx.userPreferences.findUnique({
        where: { userId },
        select: { data: true, updatedAt: true },
      });
      const document = next({
        locale: locked.locale,
        data: row?.data ?? null,
        updatedAt: row?.updatedAt ?? null,
      });

      // The document has passed `userPreferencesSchema` (the service checks it
      // before returning it), so every value in it came from parsed JSON and is
      // JSON again. The cast only names that for Prisma, which cannot see
      // through `reading`'s `Record<string, unknown>`.
      const data = document as unknown as Prisma.InputJsonValue;
      const saved = await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, data },
        update: { data },
        select: { data: true, updatedAt: true },
      });
      return {
        locale: locked.locale,
        data: saved.data,
        updatedAt: saved.updatedAt,
      };
    });
  }

  async reset(userId: string): Promise<StoredPreferences | null> {
    // An empty row, not a deleted one: `updatedAt` is the version clients
    // compare to decide whether a save they never heard back about landed, so
    // it must move forward on a reset rather than return to null — a null it
    // had once before would make a landed save look unsent and replay it over
    // the reset. `{}` reads as the defaults field by field, and those still
    // follow the account's locale.
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ locale: string }[]>`
        SELECT "locale" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
      if (!locked) return null;
      const saved = await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, data: {} },
        update: { data: {} },
        select: { updatedAt: true },
      });
      return { locale: locked.locale, data: {}, updatedAt: saved.updatedAt };
    });
  }
}

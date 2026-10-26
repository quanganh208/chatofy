import { Injectable } from '@nestjs/common';
import type { ConferenceMinutes, MinutesStatus } from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Where a conference's one minutes copy is kept.
 *
 * Keyed by the conference id ALONE, and that is safe only because of who calls
 * it: `ConferenceMinutesService` checks the caller against the Conference row
 * (owner or participant, `visibleToCaller`) before either method runs. Nothing
 * else may call this with a route parameter.
 */
export interface ConferenceMinutesStore {
  get(conferenceId: string): Promise<ConferenceMinutes | null>;
  /** Create or replace the room's minutes, action items included. */
  put(minutes: ConferenceMinutes): Promise<ConferenceMinutes>;
  /**
   * Store a `failed` record unless a `ready` copy is stored, atomically;
   * `'kept'` when the ready copy stood. `failed` carries no action items.
   */
  putFailedUnlessReady(failed: ConferenceMinutes): Promise<'saved' | 'kept'>;
}

/**
 * Postgres-backed conference minutes — the twin of `PrismaMinutesStore`, minus
 * its owner resolution (see {@link ConferenceMinutesStore} on why).
 *
 * `put` upserts and, on update, replaces the whole action-item set in one write
 * (`deleteMany` then `create`), so a shorter regenerated list never leaves a
 * stale tail. The ids the service minted are stored as given.
 */
@Injectable()
export class PrismaConferenceMinutesStore implements ConferenceMinutesStore {
  constructor(private readonly prisma: PrismaService) {}

  async get(conferenceId: string): Promise<ConferenceMinutes | null> {
    const row = await this.prisma.conferenceMinutes.findUnique({
      where: { conferenceId },
      select: {
        status: true,
        summary: true,
        keyPoints: true,
        decisions: true,
        generatedAt: true,
        model: true,
        actionItems: { orderBy: { position: 'asc' } },
      },
    });
    if (!row) return null;
    return {
      conferenceId,
      status: row.status as MinutesStatus,
      summary: row.summary,
      keyPoints: row.keyPoints,
      decisions: row.decisions,
      actionItems: row.actionItems.map((item) => ({
        id: item.id,
        description: item.description,
        owner: item.owner,
        dueDate: item.dueDate,
      })),
      generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
      model: row.model,
    };
  }

  async put(minutes: ConferenceMinutes): Promise<ConferenceMinutes> {
    try {
      await this.upsert(minutes);
    } catch (err) {
      // Any participant may generate, so two can press it at once. A nested
      // `create` keeps Prisma from issuing a native ON CONFLICT upsert, and the
      // loser of the race is refused on the unique `conferenceId`. Running the
      // upsert again takes its update branch: the later pass replaces the
      // earlier one, which is what a regenerate means anyway.
      if (!isUniqueViolation(err)) throw err;
      await this.upsert(minutes);
    }
    // The input already IS what was stored, so return it rather than read back.
    return minutes;
  }

  async putFailedUnlessReady(
    failed: ConferenceMinutes,
  ): Promise<'saved' | 'kept'> {
    const fields = {
      status: failed.status,
      summary: failed.summary,
      keyPoints: failed.keyPoints,
      decisions: failed.decisions,
      generatedAt: null,
      model: null,
    };
    // One conditional UPDATE: a `ready` row written by a concurrent pass is never
    // matched, however the two interleave. Rows that are not ready hold no action
    // items, so there is nothing to clear alongside.
    const { count } = await this.prisma.conferenceMinutes.updateMany({
      where: { conferenceId: failed.conferenceId, status: { not: 'ready' } },
      data: fields,
    });
    if (count > 0) return 'saved';
    try {
      await this.prisma.conferenceMinutes.create({
        data: { conferenceId: failed.conferenceId, ...fields },
      });
      return 'saved';
    } catch (err) {
      // The row exists: it was ready all along, or another pass just wrote it.
      // Either way it is newer than this failure, so it stands.
      if (isUniqueViolation(err)) return 'kept';
      throw err;
    }
  }

  private async upsert(minutes: ConferenceMinutes): Promise<void> {
    const fields = {
      status: minutes.status,
      summary: minutes.summary,
      keyPoints: minutes.keyPoints,
      decisions: minutes.decisions,
      generatedAt: minutes.generatedAt ? new Date(minutes.generatedAt) : null,
      model: minutes.model,
    };
    // `position` from the array index so the model's ordering survives.
    const actionItems = minutes.actionItems.map((item, position) => ({
      id: item.id,
      description: item.description,
      owner: item.owner,
      dueDate: item.dueDate,
      position,
    }));

    await this.prisma.conferenceMinutes.upsert({
      where: { conferenceId: minutes.conferenceId },
      create: {
        conferenceId: minutes.conferenceId,
        ...fields,
        actionItems: { create: actionItems },
      },
      update: {
        ...fields,
        actionItems: { deleteMany: {}, create: actionItems },
      },
    });
  }
}

/**
 * Prisma's unique-constraint refusal, matched structurally for the reason
 * `prisma-user.repository.ts` gives: the generated error class is a build
 * artifact this file should not need to type-check.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

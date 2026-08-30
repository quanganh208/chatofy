import { Injectable } from '@nestjs/common';
import type { MeetingMinutes, MinutesStatus } from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MinutesStore } from '../interfaces/minutes-store.interface';

/** The row shape a read returns — the columns {@link toMinutes} maps. */
interface MinutesRow {
  sessionId: string;
  status: string;
  summary: string;
  keyPoints: string[];
  decisions: string[];
  generatedAt: Date | null;
  model: string | null;
  actionItems: {
    id: string;
    description: string;
    owner: string | null;
    dueDate: string | null;
  }[];
}

/**
 * Postgres-backed minutes store — the durable seam behind MINUTES_STORE.
 *
 * Same contract as {@link MemoryMinutesStore}, scoped by `(ownerId, sessionId)`
 * via the table's compound unique key. A regenerate OVERWRITES: `put` upserts
 * the row and, on update, replaces the whole action-item set in one atomic
 * write (`deleteMany` then `create`), so a shorter regenerated list never leaves
 * a stale tail behind. The `id` each action item carries is the one the service
 * minted; it is stored as given so the client's reference survives the trip.
 */
@Injectable()
export class PrismaMinutesStore implements MinutesStore {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    ownerId: string,
    sessionId: string,
  ): Promise<MeetingMinutes | null> {
    const row = await this.prisma.meetingMinutes.findUnique({
      where: { ownerId_sessionId: { ownerId, sessionId } },
      include: { actionItems: { orderBy: { position: 'asc' } } },
    });
    return row ? toMinutes(row) : null;
  }

  async put(ownerId: string, minutes: MeetingMinutes): Promise<MeetingMinutes> {
    const fields = {
      status: minutes.status,
      summary: minutes.summary,
      keyPoints: minutes.keyPoints,
      decisions: minutes.decisions,
      // The domain carries an ISO string; the column is a timestamp.
      generatedAt: minutes.generatedAt ? new Date(minutes.generatedAt) : null,
      model: minutes.model,
    };
    // `position` is assigned from the array index so the model's ordering
    // survives a round-trip — Postgres arrays keep order for keyPoints/decisions,
    // but a keyed child relation does not without it.
    const actionItems = minutes.actionItems.map((item, position) => ({
      id: item.id,
      description: item.description,
      owner: item.owner,
      dueDate: item.dueDate,
      position,
    }));

    await this.prisma.meetingMinutes.upsert({
      where: { ownerId_sessionId: { ownerId, sessionId: minutes.sessionId } },
      create: {
        ownerId,
        sessionId: minutes.sessionId,
        ...fields,
        actionItems: { create: actionItems },
      },
      update: {
        ...fields,
        // Replace, not merge: the minutes are a view, not a log.
        actionItems: { deleteMany: {}, create: actionItems },
      },
    });

    // The input already IS what was stored (ids + timestamp were assigned by the
    // service upstream), so return it rather than paying a read-back.
    return minutes;
  }
}

/** Map a persisted row to the domain artifact — never exposes ownerId or ids of the join. */
function toMinutes(row: MinutesRow): MeetingMinutes {
  return {
    sessionId: row.sessionId,
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

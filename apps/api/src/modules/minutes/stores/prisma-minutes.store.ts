import { Injectable, NotFoundException } from '@nestjs/common';
import type { MeetingMinutes, MinutesStatus } from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MinutesStore } from '../interfaces/minutes-store.interface';

/** The row shape a read returns — the columns {@link toMinutes} maps. */
interface MinutesRow {
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
 * ## Owner scoping is TWO steps, and that is not incidental
 *
 * `MeetingMinutes.conversationId` references `Conversation.id`, a server cuid,
 * while every URL carries the client-minted id. `findUnique`/`upsert` need a
 * `WhereUniqueInput`, and a nested relation filter is not one — so there is no
 * single query that both addresses the row and checks the owner.
 *
 * The shortest thing that COMPILES is `{ where: { conversationId } }` with the
 * route parameter, which reads and overwrites any user's minutes. It would even
 * pass a 404 test that seeds a client id, because the two ids are different
 * values and the lookup would simply miss.
 *
 * So both methods below resolve the conversation by `(ownerId, clientId)` first
 * and key the minutes by what that resolution returns. A caller who owns no such
 * conversation gets null from `get` and a 404 from `put`.
 *
 * ## A regenerate OVERWRITES
 *
 * `put` upserts the row and, on update, replaces the whole action-item set in
 * one atomic write (`deleteMany` then `create`), so a shorter regenerated list
 * never leaves a stale tail behind. The `id` each action item carries is the one
 * the service minted; it is stored as given so the client's reference survives
 * the trip.
 */
@Injectable()
export class PrismaMinutesStore implements MinutesStore {
  constructor(private readonly prisma: PrismaService) {}

  async get(
    ownerId: string,
    conversationId: string,
  ): Promise<MeetingMinutes | null> {
    const conversation = await this.resolve(ownerId, conversationId);
    if (!conversation) return null;

    const row = await this.prisma.meetingMinutes.findUnique({
      where: { conversationId: conversation.id },
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
    return row ? toMinutes(conversationId, row) : null;
  }

  async put(ownerId: string, minutes: MeetingMinutes): Promise<MeetingMinutes> {
    const conversation = await this.resolve(ownerId, minutes.conversationId);
    if (!conversation) {
      // Reachable: the user can delete the conversation while a generation is in
      // flight. A 404 is the honest answer; letting it reach Postgres would be
      // an FK violation the caller sees as a 500.
      throw new NotFoundException(`no conversation ${minutes.conversationId}`);
    }

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
      where: { conversationId: conversation.id },
      create: {
        conversationId: conversation.id,
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

  /**
   * The conversation row this caller owns under that client-minted id, or null.
   *
   * The whole ownership check, in one place, so neither method above can be
   * written without it.
   */
  private resolve(
    ownerId: string,
    clientId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.conversation.findUnique({
      where: { ownerId_clientId: { ownerId, clientId } },
      select: { id: true },
    });
  }
}

/**
 * Map a persisted row to the domain artifact.
 *
 * The `conversationId` it carries is the CLIENT-minted id the caller asked with,
 * never the row's server cuid — that value is internal, and echoing it would put
 * a second name for the same conversation into the contract.
 */
function toMinutes(conversationId: string, row: MinutesRow): MeetingMinutes {
  return {
    conversationId,
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

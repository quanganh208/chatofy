import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConferenceDetailResponse,
  ConferenceListResponse,
  ConferenceResponse,
  CreateConferenceRequest,
} from '@chatofy/types';
import { PrismaService } from '../../prisma/prisma.service';
import { visibleToCaller } from './conference-access';
import { ConferenceRoomRegistry } from './conference-room-registry.service';

/** Whether a room id may be joined, as the gateway reports it. */
export type JoinableStatus = 'joinable' | 'room_not_found' | 'room_ended';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class ConferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: ConferenceRoomRegistry,
  ) {}

  /**
   * Create a new conference room owned by the caller.
   */
  async create(
    ownerId: string,
    body: CreateConferenceRequest,
  ): Promise<ConferenceResponse> {
    const conference = await this.prisma.conference.create({
      data: {
        ownerId,
        title: body.title ?? null,
        status: 'waiting',
      },
    });
    return this.toResponse(conference);
  }

  /**
   * List all conferences where the caller is owner OR participant.
   * Newest first, page-based with ?page and ?limit.
   */
  async list(
    callerId: string,
    opts: { page?: number; limit?: number },
  ): Promise<ConferenceListResponse> {
    const page = Math.max(1, opts.page ?? DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
    const skip = (page - 1) * limit;

    const where = {
      OR: [
        { ownerId: callerId },
        { participants: { some: { userId: callerId } } },
      ],
    };

    const [conferences, total] = await this.prisma.$transaction([
      this.prisma.conference.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.conference.count({ where }),
    ]);

    return {
      conferences: conferences.map((c) => this.toResponse(c)),
      total,
      page,
      limit,
    };
  }

  /**
   * Get a single conference by id.
   * Raises 404 when the caller has no row (owner or participant) — IDOR guard.
   */
  async findOne(
    conferenceId: string,
    callerId: string,
  ): Promise<ConferenceDetailResponse> {
    const conference = await this.prisma.conference.findFirst({
      where: visibleToCaller(conferenceId, callerId),
      include: {
        participants: true,
        _count: { select: { turns: true } },
      },
    });

    if (!conference) {
      throw new NotFoundException('Conference not found');
    }

    return {
      id: conference.id,
      status: conference.status,
      title: conference.title ?? undefined,
      createdAt: conference.createdAt.toISOString(),
      ownerId: conference.ownerId,
      // Absent rather than null, like `leftAt`: a room nobody entered has no
      // start, and an open one no end. The end screen derives duration from both.
      startedAt: conference.startedAt?.toISOString(),
      endedAt: conference.endedAt?.toISOString(),
      participants: conference.participants.map((p) => ({
        id: p.id,
        userId: p.userId,
        displayName: p.displayName ?? undefined,
        sourceLanguage: p.sourceLanguage,
        status: p.status,
        joinedAt: p.joinedAt.toISOString(),
        leftAt: p.leftAt ? p.leftAt.toISOString() : undefined,
      })),
      _count: { turns: conference._count.turns },
    };
  }

  /**
   * Whether `conferenceId` names a room that can be joined.
   *
   * Link is access: any signed-in caller holding the id may join, so this
   * checks only that the room was minted by `POST /conference` and has not
   * been ended.
   */
  async joinableStatus(conferenceId: string): Promise<JoinableStatus> {
    const conference = await this.prisma.conference.findUnique({
      where: { id: conferenceId },
      select: { status: true },
    });
    if (!conference) return 'room_not_found';
    return conference.status === 'ended' ? 'room_ended' : 'joinable';
  }

  /**
   * Flip a `waiting` room to `active` on its first successful join.
   * A no-op for a room that is already active or ended.
   */
  async markActive(conferenceId: string): Promise<void> {
    await this.prisma.conference.updateMany({
      where: { id: conferenceId, status: 'waiting' },
      data: { status: 'active', startedAt: new Date() },
    });
  }

  /**
   * End a conference: set status='ended', endedAt=now(), then end the live
   * room — every peer gets `conference.ended` and its socket closes with 4001.
   * Ending an already-ended room changes nothing and returns it as it is.
   * Raises 403 when the caller is not the owner.
   * Raises 404 when the conference does not exist.
   */
  async end(
    conferenceId: string,
    callerId: string,
  ): Promise<ConferenceResponse> {
    const conference = await this.prisma.conference.findUnique({
      where: { id: conferenceId },
    });

    if (!conference) {
      throw new NotFoundException('Conference not found');
    }

    if (conference.ownerId !== callerId) {
      throw new ForbiddenException('Only the owner can end a conference');
    }

    const ended =
      conference.status === 'ended'
        ? conference
        : await this.prisma.conference.update({
            where: { id: conferenceId },
            data: { status: 'ended', endedAt: new Date() },
          });

    // After the write, so a join racing this one is refused by the status
    // check if it has not reached the room yet, and closed here if it has.
    this.rooms.endRoom(conferenceId);
    return this.toResponse(ended);
  }

  private toResponse(conference: {
    id: string;
    status: string;
    title: string | null;
    createdAt: Date;
    ownerId: string;
  }): ConferenceResponse {
    return {
      id: conference.id,
      status: conference.status,
      title: conference.title ?? undefined,
      createdAt: conference.createdAt.toISOString(),
      ownerId: conference.ownerId,
    };
  }
}

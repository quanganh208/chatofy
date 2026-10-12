import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface RecordTurnData {
  sourceLanguage: string;
  sourceText: string;
  searchText?: string;
  translations?: Record<string, unknown>;
  audioStartMs?: number;
  audioDurationMs?: number;
}

export interface RecordMessageData {
  text: string;
  sourceLanguage: string;
}

/**
 * Persistence layer for conference in-session events.
 *
 * Each method is fire-and-forget safe to call from the gateway — errors are
 * logged but not rethrown so a DB hiccup never kills the WebSocket handler.
 */
@Injectable()
export class ConferencePersistenceService {
  private readonly logger = new Logger(ConferencePersistenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert a participant row on join.
   *
   * Uses the @@unique([conferenceId, userId]) constraint so re-joining an
   * existing conference updates the row rather than creating a duplicate.
   * Returns the participant row id.
   */
  async recordJoin(
    conferenceId: string,
    userId: string,
    displayName: string | undefined,
    sourceLanguage: string,
  ): Promise<string> {
    const participant = await this.prisma.conferenceParticipant.upsert({
      where: { conferenceId_userId: { conferenceId, userId } },
      create: {
        conferenceId,
        userId,
        displayName: displayName ?? null,
        sourceLanguage,
        status: 'joined',
      },
      update: {
        displayName: displayName ?? null,
        sourceLanguage,
        status: 'joined',
        leftAt: null,
      },
    });
    return participant.id;
  }

  /**
   * Mark a participant as left.
   */
  async recordLeave(conferenceId: string, userId: string): Promise<void> {
    try {
      await this.prisma.conferenceParticipant.updateMany({
        where: { conferenceId, userId, status: { not: 'left' } },
        data: { status: 'left', leftAt: new Date() },
      });
    } catch (err) {
      this.logger.error(
        `recordLeave failed for user ${userId} in conference ${conferenceId}`,
        err,
      );
    }
  }

  /**
   * Persist one speech turn from a participant.
   */
  async recordTurn(
    participantId: string,
    conferenceId: string,
    data: RecordTurnData,
  ): Promise<void> {
    try {
      await this.prisma.conferenceTurn.create({
        data: {
          conferenceId,
          participantId,
          sourceLanguage: data.sourceLanguage,
          sourceText: data.sourceText,
          searchText: data.searchText ?? null,
          translations: data.translations
            ? (data.translations as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          audioStartMs: data.audioStartMs ?? null,
          audioDurationMs: data.audioDurationMs ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `recordTurn failed for participant ${participantId} in conference ${conferenceId}`,
        err,
      );
    }
  }

  /**
   * Persist one chat message from a participant.
   */
  async recordMessage(
    participantId: string,
    conferenceId: string,
    data: RecordMessageData,
  ): Promise<void> {
    try {
      await this.prisma.conferenceMessage.create({
        data: {
          conferenceId,
          participantId,
          text: data.text,
          sourceLanguage: data.sourceLanguage,
        },
      });
    } catch (err) {
      this.logger.error(
        `recordMessage failed for participant ${participantId} in conference ${conferenceId}`,
        err,
      );
    }
  }
}

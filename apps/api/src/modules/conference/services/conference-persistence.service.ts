import { Injectable, Logger } from '@nestjs/common';
import type { LanguageCode } from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';

export interface RecordTurnData {
  sourceLanguage: LanguageCode;
  sourceText: string;
  searchText?: string;
  translations: Partial<Record<LanguageCode, string>>;
}

export interface RecordMessageData {
  text: string;
  sourceLanguage: LanguageCode;
}

/**
 * Persistence layer for conference in-session events.
 *
 * `recordJoin` throws, because a join cannot succeed without its participant
 * row. Everything else is fire-and-forget safe to call from the gateway: errors
 * are logged but not rethrown so a DB hiccup never kills a WebSocket handler.
 *
 * Joins and leaves for one (conference, user) run strictly in the order they
 * were requested. There is one participant row per pair, so a leave from a
 * socket that closed straight after joining must not land before that join's
 * upsert (leaving the row `joined` forever), and a quick leave-then-rejoin must
 * not have the leave overwrite the rejoin.
 */
@Injectable()
export class ConferencePersistenceService {
  private readonly logger = new Logger(ConferencePersistenceService.name);
  /** Tail of the pending join/leave chain per (conference, user). */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert the caller's participant row and return its id.
   *
   * Never creates the Conference: a room exists only once `POST /conference`
   * minted it, and the gateway checks that before calling this.
   */
  recordJoin(
    conferenceId: string,
    userId: string,
    displayName: string,
    sourceLanguage: LanguageCode,
  ): Promise<string> {
    return this.serialize(conferenceId, userId, async () => {
      const participant = await this.prisma.conferenceParticipant.upsert({
        where: { conferenceId_userId: { conferenceId, userId } },
        create: {
          conferenceId,
          userId,
          displayName,
          sourceLanguage,
          status: 'joined',
        },
        update: { displayName, sourceLanguage, status: 'joined', leftAt: null },
        select: { id: true },
      });
      return participant.id;
    });
  }

  /** Mark a participant as left. Never rejects. */
  recordLeave(conferenceId: string, userId: string): Promise<void> {
    return this.serialize(conferenceId, userId, async () => {
      await this.prisma.conferenceParticipant.updateMany({
        where: { conferenceId, userId, status: { not: 'left' } },
        data: { status: 'left', leftAt: new Date() },
      });
    }).catch((err: unknown) => {
      this.logger.error(
        `recordLeave failed for user ${userId} in conference ${conferenceId}`,
        err,
      );
    });
  }

  /** Persist one finished speech turn. Never rejects. */
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
          translations: data.translations,
        },
      });
    } catch (err) {
      this.logger.error(
        `recordTurn failed for participant ${participantId} in conference ${conferenceId}`,
        err,
      );
    }
  }

  /** Persist one chat message, in the sender's language. Never rejects. */
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

  /** Run `task` after every earlier join/leave for the same pair settled. */
  private serialize<T>(
    conferenceId: string,
    userId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    // A newline cannot appear in either id, so two pairs cannot share a key.
    const key = `${conferenceId}\n${userId}`;
    // The stored tail never rejects, so one failed write cannot skip the next.
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.then(task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(key, settled);
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key);
    });
    return run;
  }
}

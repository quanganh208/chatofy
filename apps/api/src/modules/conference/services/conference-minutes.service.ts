import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConferenceMinutes,
  GenerateMinutesRequest,
  MinutesSourceTurn,
} from '@chatofy/types';
import { PrismaService } from '../../../prisma/prisma.service';
import { runMinutesPass } from '../../minutes/minutes-pass';
import { MinutesSummarizer } from '../../minutes/minutes-summarizer.service';
import { visibleToCaller } from '../conference-access';
import {
  PrismaConferenceMinutesStore,
  type ConferenceMinutesStore,
} from '../stores/prisma-conference-minutes.store';

/**
 * The label a turn gets in the prompt when its speaker gave no name. English
 * for the reason `minutes.service.ts` gives: it never reaches a screen, and the
 * model is told separately which language to write in.
 */
const SPEAKER_FALLBACK = 'Speaker';

/**
 * Minutes for a conference room, on demand.
 *
 * One stored copy per room, readable by everyone who may read the room itself
 * — the owner and every participant — and anyone of them may (re)generate it,
 * in their own language, replacing whatever was there. Everybody else gets the
 * same 404 `GET /conference/:id` gives them.
 *
 * The pass is the one the conversation minutes run ({@link runMinutesPass}):
 * the same prompt ceiling, the same `failed` record that never replaces a
 * readable copy, the same 503/502 for a provider fault.
 */
@Injectable()
export class ConferenceMinutesService {
  private readonly logger = new Logger(ConferenceMinutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly summarizer: MinutesSummarizer,
    @Inject(PrismaConferenceMinutesStore)
    private readonly store: ConferenceMinutesStore,
  ) {}

  /** The room's minutes, or null when nobody has generated them yet. */
  async get(
    conferenceId: string,
    callerId: string,
  ): Promise<ConferenceMinutes | null> {
    await this.assertVisible(conferenceId, callerId);
    return this.store.get(conferenceId);
  }

  /**
   * Generate (or regenerate) the room's minutes from its stored turns.
   *
   * Every refusal — 404 for a room the caller was not in, 400 for one where
   * nothing was said or too much to summarize — happens before the provider is
   * called, so none spends a billed pass.
   */
  async generate(
    conferenceId: string,
    callerId: string,
    request: GenerateMinutesRequest,
  ): Promise<ConferenceMinutes> {
    await this.assertVisible(conferenceId, callerId);

    const turns = await this.sourceTurns(conferenceId);
    if (turns.length === 0) {
      throw new BadRequestException('the meeting has nothing to summarize');
    }

    return runMinutesPass({
      turns,
      language: request.language,
      summarizer: this.summarizer,
      logger: this.logger,
      label: `conference ${conferenceId}`,
      save: (content) => this.store.put({ conferenceId, ...content }),
      storedStatus: async () =>
        (await this.store.get(conferenceId))?.status ?? null,
    });
  }

  /** 404 unless the caller owns the room or has a participant row in it. */
  private async assertVisible(
    conferenceId: string,
    callerId: string,
  ): Promise<void> {
    const conference = await this.prisma.conference.findFirst({
      where: visibleToCaller(conferenceId, callerId),
      select: { id: true },
    });
    if (!conference) throw new NotFoundException('Conference not found');
  }

  /**
   * The room's turns as labelled prompt lines, in the order they were spoken.
   *
   * Ordered by creation: `audioStartMs` is never written today (the gateway
   * records a turn when it settles), so creation order IS speaking order, and
   * the id breaks a tie between two turns settled in the same millisecond.
   * The line is the speaker's own words (`sourceText`); the model is given the
   * meeting as it was held, not a translation of it. Blank turns are dropped.
   */
  private async sourceTurns(
    conferenceId: string,
  ): Promise<MinutesSourceTurn[]> {
    const rows = await this.prisma.conferenceTurn.findMany({
      where: { conferenceId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        sourceText: true,
        participant: { select: { displayName: true } },
      },
    });
    const out: MinutesSourceTurn[] = [];
    for (const row of rows) {
      const text = row.sourceText.trim();
      if (!text) continue;
      out.push({
        speakerLabel: row.participant.displayName?.trim() || SPEAKER_FALLBACK,
        text,
      });
    }
    return out;
  }
}

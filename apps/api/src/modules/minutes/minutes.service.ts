import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConversationTurn,
  GenerateMinutesRequest,
  MeetingMinutes,
  MinutesSourceTurn,
} from '@chatofy/types';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversations/interfaces/conversation-store.interface';
import {
  MINUTES_STORE,
  type MinutesStore,
} from './interfaces/minutes-store.interface';
import { MinutesSummarizer } from './minutes-summarizer.service';
import { runMinutesPass } from './minutes-pass';

/**
 * Fallback speaker names for the PROMPT.
 *
 * A stored turn's `speakerLabel` is null when the user never attributed the
 * block, and the minutes are written for a human, so the prompt still needs a
 * name to attach the line to. English is correct here in a way it would not be
 * in a database row: this string never reaches a screen — it goes into a prompt,
 * and the model is separately told which language to write the minutes in.
 */
const ROLE_FALLBACK: Record<string, string> = {
  speaker_a: 'Speaker A',
  speaker_b: 'Speaker B',
};

/**
 * Turns a stored conversation into minutes and persists them.
 *
 * The transcript is held server-side now, so `generate` names a conversation
 * instead of carrying its turns. The pass itself — the prompt ceiling, the
 * minted ids and timestamp, the failure semantics and the HTTP mapping — is
 * {@link runMinutesPass}, shared with the conference minutes; this service owns
 * loading the conversation and where its minutes are stored.
 */
@Injectable()
export class MinutesService {
  private readonly logger = new Logger(MinutesService.name);

  constructor(
    private readonly summarizer: MinutesSummarizer,
    @Inject(MINUTES_STORE) private readonly store: MinutesStore,
    @Inject(CONVERSATION_STORE)
    private readonly conversations: ConversationStore,
  ) {}

  /**
   * The caller's stored minutes for a conversation, or null if they have none.
   *
   * `ownerId` is the authenticated caller (from the verified token); the store
   * resolves the conversation by `(ownerId, clientId)` before it looks at a
   * minutes row, so this never returns another user's minutes for a guessed id.
   */
  get(ownerId: string, conversationId: string): Promise<MeetingMinutes | null> {
    return this.store.get(ownerId, conversationId);
  }

  /**
   * Generate (or regenerate) the caller's minutes from the STORED transcript.
   *
   * The conversation is loaded first, and every refusal it can produce — 404 for
   * an id the caller does not own, 400 for a transcript with nothing in it or
   * over the prompt ceiling — happens BEFORE the provider is touched, so none
   * spends a billed call. A failed pass is recorded as `failed` without ever
   * replacing a readable copy; see {@link runMinutesPass}.
   */
  async generate(
    ownerId: string,
    conversationId: string,
    request: GenerateMinutesRequest,
  ): Promise<MeetingMinutes> {
    const conversation = await this.conversations.get(ownerId, conversationId);
    if (!conversation) {
      throw new NotFoundException(`no conversation ${conversationId}`);
    }

    const turns = toSourceTurns(conversation.turns);
    if (turns.length === 0) {
      throw new BadRequestException(
        'the conversation has nothing to summarize',
      );
    }

    return runMinutesPass({
      turns,
      language: request.language,
      summarizer: this.summarizer,
      logger: this.logger,
      label: `conversation ${conversationId}`,
      save: (content) =>
        this.store.put(ownerId, { conversationId, ...content }),
      storedStatus: async () =>
        (await this.store.get(ownerId, conversationId))?.status ?? null,
    });
  }
}

/**
 * Stored display blocks → the labelled lines the prompt expects.
 *
 * `displayText ?? sourceText` is the same rule the history screen renders by, so
 * the summary is drawn from the text the user actually read rather than from raw
 * recognizer output the repair pass already improved on.
 *
 * Empty lines are dropped: a block the recognizer produced nothing for is not
 * worth summarizing.
 */
function toSourceTurns(
  turns: readonly ConversationTurn[],
): MinutesSourceTurn[] {
  const out: MinutesSourceTurn[] = [];
  for (const turn of turns) {
    const text = (turn.displayText ?? turn.sourceText).trim();
    if (!text) continue;
    out.push({
      speakerLabel:
        turn.speakerLabel ?? ROLE_FALLBACK[turn.speakerRole] ?? 'Speaker',
      text,
    });
  }
  return out;
}

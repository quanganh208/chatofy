import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
  ProviderRegistry,
  type MeetingMinutesDraft,
  type SummarizationProvider,
} from '@chatofy/ai-providers';
import {
  MINUTES_LIMITS,
  type ConversationTurn,
  type GenerateMinutesRequest,
  type MeetingMinutes,
  type MinutesSourceTurn,
} from '@chatofy/types';
import { Env } from '../../config/env.schema';
import {
  CONVERSATION_STORE,
  type ConversationStore,
} from '../conversations/interfaces/conversation-store.interface';
import {
  MINUTES_STORE,
  type MinutesStore,
} from './interfaces/minutes-store.interface';

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
 * instead of carrying its turns. Everything the minutes need beyond the model's
 * own words — stable action-item ids, the generated-at instant, the persisted
 * status — is assigned HERE, keeping the provider a pure function of its prompt
 * (see the SummarizationProvider contract on why the draft carries none of it).
 */
@Injectable()
export class MinutesService {
  private readonly logger = new Logger(MinutesService.name);
  /** Resolved once and kept warm, like the pipeline factory's cached providers. */
  private provider: SummarizationProvider | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly registry: ProviderRegistry,
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
   * The conversation is loaded first, and both refusals it can produce — 404 for
   * an id the caller does not own, 400 for a transcript over the prompt ceiling —
   * happen BEFORE the provider is touched, so neither spends a billed call.
   *
   * A provider failure is recorded as a `failed` artifact before it is rethrown,
   * so a later GET can tell "never generated" (null) from "the last pass threw"
   * (a stored failed record) — the distinction the status enum exists to carry.
   * It is NOT recorded over minutes that are already readable: see
   * {@link MinutesService.recordFailure}.
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

    // The ceiling moved off the request body with the turns, but it still has to
    // be enforced: this is what the model is billed on. Deliberately NOT the
    // storage ceiling — a conversation too long to summarize is still saved and
    // still readable, which is why the two numbers are separate.
    const totalChars = turns.reduce(
      (sum, turn) => sum + turn.speakerLabel.length + turn.text.length,
      0,
    );
    if (totalChars > MINUTES_LIMITS.MAX_TOTAL_CHARS) {
      throw new BadRequestException(
        `transcript exceeds ${MINUTES_LIMITS.MAX_TOTAL_CHARS} characters`,
      );
    }

    const transcript = buildTranscript(turns);
    try {
      const draft = await this.summarizer().summarize({
        transcript,
        language: request.language,
      });
      return await this.store.put(ownerId, toMinutes(conversationId, draft));
    } catch (err) {
      this.logger.warn(
        `minutes generation failed for conversation ${conversationId}: ${String(err)}`,
      );
      await this.recordFailure(ownerId, conversationId);
      throw asHttpError(err);
    }
  }

  /**
   * Write the `failed` record — but never over minutes somebody can still read,
   * and never let that write replace the real error.
   *
   * A regenerate runs against a conversation that may already HAVE minutes, and
   * the store's `put` replaces the row wholesale. So a reader who opens a good
   * summary, presses Regenerate and meets a provider outage would have the good
   * summary overwritten with an empty `failed` record: a reload then shows the
   * empty state, indistinguishable from "never generated", and the only copy of
   * a billed result is gone. A failed attempt says nothing about the previous
   * one, so a stored `ready` artifact stands and only the request fails — the
   * caller is still told generation failed, by the error `generate` rethrows.
   *
   * Any other stored state (none, `failed`, `pending`) is replaced as before,
   * which is what keeps "the last pass threw" tellable from "never generated".
   *
   * Both `put` calls became failable when minutes were re-keyed onto a
   * conversation: the parent is an FK now, so deleting the conversation
   * mid-generation makes the write throw. Unguarded, that throw escapes the
   * catch block, `asHttpError` never runs, and the original cause — including a
   * provider error for an LLM call that already succeeded and was billed — is
   * discarded in favour of an opaque 500. The read above is inside the same
   * guard for the same reason.
   *
   * Logged separately from the provider failure for the same reason: "provider
   * threw" and "persist threw" are different faults and must not read alike.
   */
  private async recordFailure(
    ownerId: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const stored = await this.store.get(ownerId, conversationId);
      if (stored?.status === 'ready') {
        this.logger.warn(
          `keeping the readable minutes stored for conversation ` +
            `${conversationId}; the failed attempt is not recorded over them`,
        );
        return;
      }
      await this.store.put(ownerId, failedMinutes(conversationId));
    } catch (err) {
      this.logger.warn(
        `could not persist the failed-minutes record for conversation ` +
          `${conversationId}: ${String(err)}`,
      );
    }
  }

  /**
   * `resolveOnly`, like the realtime and speaker-embedding providers: no env var
   * selects a summarizer, so a second registration should be a loud error rather
   * than a silent pick. The Gemini key is read here and passed raw — splitting a
   * comma-separated pool is the provider's job.
   */
  private summarizer(): SummarizationProvider {
    this.provider ??= this.registry.resolveOnly('summarization', {
      geminiApiKey: this.config.get('GEMINI_API_KEY', { infer: true }),
    });
    return this.provider;
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

/** `Label: text` lines, in the order spoken — the shape the prompt expects. */
function buildTranscript(turns: readonly MinutesSourceTurn[]): string {
  return turns.map((t) => `${t.speakerLabel}: ${t.text}`).join('\n');
}

/** Map a model draft onto the stored domain artifact, minting ids + timestamp. */
function toMinutes(
  conversationId: string,
  draft: MeetingMinutesDraft,
): MeetingMinutes {
  return {
    conversationId,
    status: 'ready',
    summary: draft.summary,
    keyPoints: draft.keyPoints,
    decisions: draft.decisions,
    actionItems: draft.actionItems.map((item) => ({
      id: randomUUID(),
      description: item.description,
      owner: item.owner,
      dueDate: item.dueDate,
    })),
    generatedAt: new Date().toISOString(),
    model: draft.model,
  };
}

/** The record written when a generation attempt throws. */
function failedMinutes(conversationId: string): MeetingMinutes {
  return {
    conversationId,
    status: 'failed',
    summary: '',
    keyPoints: [],
    decisions: [],
    actionItems: [],
    generatedAt: null,
    model: null,
  };
}

/**
 * Translate a provider failure into the right HTTP status, so the caller is not
 * told "internal error" for an upstream condition it can act on.
 *
 * - No key configured / whole pool cooling down → 503: the summarizer is not
 *   available right now, and retrying later is the correct advice.
 * - The model answered but the body was unusable → 502: a bad answer from an
 *   upstream dependency, not a fault in this service.
 *
 * Anything else is returned unchanged and becomes a 500 — the honest status for
 * a cause this code did not anticipate. The AllExceptionsFilter forces a generic
 * message on every 5xx, so none of the provider's internal text leaks either
 * way; only the status differs.
 */
function asHttpError(err: unknown): unknown {
  if (
    err instanceof ProviderConfigError ||
    err instanceof ProviderConnectionError
  ) {
    return new ServiceUnavailableException(
      'minutes generation is temporarily unavailable',
    );
  }
  if (err instanceof ProviderResponseError) {
    return new BadGatewayException(
      'the summarization backend returned an unusable response',
    );
  }
  return err;
}

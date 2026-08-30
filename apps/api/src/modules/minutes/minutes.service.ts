import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ProviderRegistry,
  type MeetingMinutesDraft,
  type SummarizationProvider,
} from '@chatofy/ai-providers';
import type {
  GenerateMinutesRequest,
  MeetingMinutes,
  MinutesSourceTurn,
} from '@chatofy/types';
import { Env } from '../../config/env.schema';
import {
  MINUTES_STORE,
  type MinutesStore,
} from './interfaces/minutes-store.interface';

/**
 * Turns a finished conversation into minutes and persists them.
 *
 * The transcript is not held server-side today, so `generate` takes the turns
 * in the request. Everything the minutes need beyond the model's own words —
 * stable action-item ids, the generated-at instant, the persisted status — is
 * assigned HERE, keeping the provider a pure function of its prompt (see the
 * SummarizationProvider contract on why the draft carries none of it).
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
  ) {}

  /** The stored minutes for a session, or null if none have been generated. */
  get(sessionId: string): Promise<MeetingMinutes | null> {
    return this.store.get(sessionId);
  }

  /**
   * Generate (or regenerate) the minutes for a session from the submitted turns.
   *
   * A provider failure is recorded as a `failed` artifact BEFORE it is rethrown,
   * so a later GET can tell "never generated" (null) from "the last pass threw"
   * (a stored failed record) — the distinction the status enum exists to carry.
   */
  async generate(
    sessionId: string,
    request: GenerateMinutesRequest,
  ): Promise<MeetingMinutes> {
    const transcript = buildTranscript(request.turns);
    try {
      const draft = await this.summarizer().summarize({
        transcript,
        language: request.language,
      });
      return this.store.put(toMinutes(sessionId, draft));
    } catch (err) {
      this.logger.warn(
        `minutes generation failed for session ${sessionId}: ${String(err)}`,
      );
      await this.store.put(failedMinutes(sessionId));
      throw err;
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

/** `Label: text` lines, in the order spoken — the shape the prompt expects. */
function buildTranscript(turns: readonly MinutesSourceTurn[]): string {
  return turns.map((t) => `${t.speakerLabel}: ${t.text}`).join('\n');
}

/** Map a model draft onto the stored domain artifact, minting ids + timestamp. */
function toMinutes(
  sessionId: string,
  draft: MeetingMinutesDraft,
): MeetingMinutes {
  return {
    sessionId,
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
function failedMinutes(sessionId: string): MeetingMinutes {
  return {
    sessionId,
    status: 'failed',
    summary: '',
    keyPoints: [],
    decisions: [],
    actionItems: [],
    generatedAt: null,
    model: null,
  };
}

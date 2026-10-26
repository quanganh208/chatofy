import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  type Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
  type MeetingMinutesDraft,
} from '@chatofy/ai-providers';
import {
  MINUTES_LIMITS,
  type LanguageCode,
  type MinutesContent,
  type MinutesSourceTurn,
  type MinutesStatus,
} from '@chatofy/types';
import type { MinutesSummarizer } from './minutes-summarizer.service';

/**
 * One summarization pass, independent of what owns the minutes.
 *
 * A stored conversation and a conference room both summarize labelled lines and
 * persist one copy; only how they load the lines and where they store the
 * result differ. Everything else — the prompt ceiling, the ready/failed
 * artifacts, never recording a failure over a readable copy, and mapping a
 * provider fault onto the right HTTP status — is this one function, so the two
 * cannot drift apart.
 */
export interface MinutesPass<T> {
  /** The labelled lines to summarize, in the order spoken. Non-empty. */
  turns: readonly MinutesSourceTurn[];
  /** The language to WRITE the minutes in; the provider defaults it. */
  language?: LanguageCode;
  summarizer: MinutesSummarizer;
  logger: Logger;
  /** Names the parent in log lines, e.g. `conversation c1`. */
  label: string;
  /** Persist an artifact (ready or failed). May throw — the parent can vanish. */
  save: (content: MinutesContent) => Promise<T>;
  /** The status of the copy stored now, or null when there is none. */
  storedStatus: () => Promise<MinutesStatus | null>;
}

/**
 * Run the pass and persist its result.
 *
 * The ceiling refusal happens BEFORE the provider is touched, so it never spends
 * a billed call. Deliberately NOT the storage ceiling — a transcript too long to
 * summarize is still saved and still readable, which is why the two numbers are
 * separate.
 *
 * A provider failure is recorded as a `failed` artifact before it is rethrown,
 * so a later read can tell "never generated" (null) from "the last pass threw"
 * (a stored failed record) — the distinction the status enum exists to carry.
 * It is NOT recorded over minutes that are already readable: see
 * {@link recordFailure}.
 */
export async function runMinutesPass<T>(pass: MinutesPass<T>): Promise<T> {
  const totalChars = pass.turns.reduce(
    (sum, turn) => sum + turn.speakerLabel.length + turn.text.length,
    0,
  );
  if (totalChars > MINUTES_LIMITS.MAX_TOTAL_CHARS) {
    throw new BadRequestException(
      `transcript exceeds ${MINUTES_LIMITS.MAX_TOTAL_CHARS} characters`,
    );
  }

  try {
    const draft = await pass.summarizer.get().summarize({
      transcript: buildTranscript(pass.turns),
      language: pass.language,
    });
    return await pass.save(readyContent(draft));
  } catch (err) {
    pass.logger.warn(
      `minutes generation failed for ${pass.label}: ${String(err)}`,
    );
    await recordFailure(pass);
    throw asHttpError(err);
  }
}

/**
 * Write the `failed` record — but never over minutes somebody can still read,
 * and never let that write replace the real error.
 *
 * A regenerate runs against a parent that may already HAVE minutes, and `save`
 * replaces the row wholesale. So a reader who opens a good summary, presses
 * Regenerate and meets a provider outage would have the good summary
 * overwritten with an empty `failed` record: a reload then shows the empty
 * state, indistinguishable from "never generated", and the only copy of a
 * billed result is gone. A failed attempt says nothing about the previous one,
 * so a stored `ready` artifact stands and only the request fails — the caller
 * is still told generation failed, by the error the pass rethrows.
 *
 * Any other stored state (none, `failed`, `pending`) is replaced, which is what
 * keeps "the last pass threw" tellable from "never generated".
 *
 * Both writes are failable: the parent is an FK, so deleting it mid-generation
 * makes the write throw. Unguarded, that throw escapes the catch block,
 * `asHttpError` never runs, and the original cause — including a provider error
 * for an LLM call that already succeeded and was billed — is discarded in favour
 * of an opaque 500. The read is inside the same guard for the same reason.
 *
 * Logged separately from the provider failure: "provider threw" and "persist
 * threw" are different faults and must not read alike.
 */
async function recordFailure<T>(pass: MinutesPass<T>): Promise<void> {
  try {
    if ((await pass.storedStatus()) === 'ready') {
      pass.logger.warn(
        `keeping the readable minutes stored for ${pass.label}; ` +
          `the failed attempt is not recorded over them`,
      );
      return;
    }
    await pass.save(failedContent());
  } catch (err) {
    pass.logger.warn(
      `could not persist the failed-minutes record for ${pass.label}: ${String(err)}`,
    );
  }
}

/** `Label: text` lines, in the order spoken — the shape the prompt expects. */
function buildTranscript(turns: readonly MinutesSourceTurn[]): string {
  return turns.map((t) => `${t.speakerLabel}: ${t.text}`).join('\n');
}

/**
 * Map a model draft onto the stored artifact, minting ids + timestamp.
 *
 * Assigned HERE rather than by the provider, keeping it a pure function of its
 * prompt (see the SummarizationProvider contract on why the draft carries none
 * of it).
 */
function readyContent(draft: MeetingMinutesDraft): MinutesContent {
  return {
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
function failedContent(): MinutesContent {
  return {
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

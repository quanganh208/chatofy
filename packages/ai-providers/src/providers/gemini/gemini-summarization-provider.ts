// Gemini meeting-minutes provider — one non-streamed JSON pass over a finished
// conversation, using the official @google/genai SDK.
//
// It shares the pool bookkeeping with the translation provider on purpose: the
// same project-per-model quota applies, so `KeyRotation` and the error
// taxonomy in `error-classification.ts` are reused verbatim rather than
// re-derived. What differs is the CALL — minutes are not latency-critical and
// come back as one JSON object, so this path blocks (no streaming) and asks the
// SDK for `application/json` so the body is a document rather than prose to
// re-parse out of a sentence.
//
// The model ladder leads with a non-lite flash model: a minutes pass reasons
// over the whole conversation at once, where the translator reasons over one
// sentence, so the quality/latency trade-off lands differently and the extra
// few hundred ms is worth it here where it was not on a live turn.
import { GoogleGenAI } from '@google/genai';
import type {
  MeetingMinutesDraft,
  SummarizationProvider,
  SummarizationRequest,
} from '../../interfaces/summarization-provider.js';
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import {
  isAuthFailure,
  isModelDenied,
  isOverloaded,
  quotaCooldownMs,
  MAX_DAILY_COOLDOWN_MS,
  OVERLOAD_COOLDOWN_MS,
} from './error-classification.js';
import { KeyRotation, resolveApiKeys } from './key-rotation.js';
import {
  buildMinutesInstruction,
  buildMinutesReminder,
  wrapMinutesTranscript,
} from './minutes-prompt-builder.js';

const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];

export interface GeminiSummarizationConfig {
  /** One key, or several comma-separated to rotate across (one key per project). */
  apiKey?: string;
  /** Models to try in order; a single-entry list disables the fallback. */
  models?: string[];
  /** A rate limit was absorbed — one (key, model) pair went on cooldown. */
  onQuotaCooldown?: (event: { model: string; cooldownMs: number }) => void;
}

/** The JSON the model is asked to return, before the app adds ids/timestamps. */
interface RawMinutes {
  summary?: unknown;
  keyPoints?: unknown;
  decisions?: unknown;
  actionItems?: unknown;
}

export class GeminiSummarizationProvider implements SummarizationProvider {
  readonly name = 'gemini';
  private readonly keys: KeyRotation;
  private readonly models: string[];
  private readonly onQuotaCooldown?: GeminiSummarizationConfig['onQuotaCooldown'];

  constructor(config: GeminiSummarizationConfig) {
    const apiKeys = resolveApiKeys(config.apiKey);
    if (!apiKeys.length) {
      throw new ProviderConfigError('Gemini summarization requires an apiKey');
    }
    this.keys = new KeyRotation(apiKeys);
    this.models = config.models?.length ? config.models : DEFAULT_MODELS;
    this.onQuotaCooldown = config.onQuotaCooldown;
  }

  async summarize(req: SummarizationRequest): Promise<MeetingMinutesDraft> {
    const instruction = buildMinutesInstruction(req.language);
    const reminder = buildMinutesReminder();
    const wrapped = wrapMinutesTranscript(req.transcript);
    return this.walk((client, model) =>
      this.generate(client, model, instruction, reminder, wrapped),
    );
  }

  /**
   * Try one attempt on each live (key, model) pair until one answers.
   *
   * The same policy as the translation provider's walk — model-major, each
   * failure condemning only as much of the matrix as its blast radius warrants.
   * Kept as its own copy rather than shared because the translator's is private
   * to its class and tuned around a streamed latency-critical call; hoisting a
   * shared walk is a refactor to make once a THIRD caller needs it, not the
   * second (see rule-of-three).
   */
  private async walk(
    attempt: (client: GoogleGenAI, model: string) => Promise<MeetingMinutesDraft>,
  ): Promise<MeetingMinutesDraft> {
    const keys = this.keys.order();
    let lastError: unknown;
    let attempted = false;
    let fatal = false;

    for (const model of this.models) {
      if (fatal) break;
      for (const { index, client } of keys) {
        if (this.keys.isRetired(index)) continue;
        if (this.keys.isCoolingDown(index, model)) continue;

        attempted = true;
        try {
          return await attempt(client, model);
        } catch (err) {
          lastError = err;
          if (this.recordFailure(err, index, model)) continue;
          if (isOverloaded(err)) {
            this.keys.coolAll(model, OVERLOAD_COOLDOWN_MS);
            break;
          }
          fatal = true;
          break;
        }
      }
    }

    throw this.failure(lastError, attempted);
  }

  /** Remember what a failure condemns; say whether the walk may step to the next key. */
  private recordFailure(err: unknown, index: number, model: string): boolean {
    const cooldown = quotaCooldownMs(err);
    if (cooldown !== null) {
      this.keys.cool(index, model, cooldown);
      this.onQuotaCooldown?.({ model, cooldownMs: cooldown });
      return true;
    }
    if (isAuthFailure(err)) {
      this.keys.retire(index);
      return true;
    }
    if (isModelDenied(err)) {
      this.keys.cool(index, model, MAX_DAILY_COOLDOWN_MS);
      return true;
    }
    return false;
  }

  private failure(lastError: unknown, attempted: boolean): Error {
    if (this.keys.allRetired) {
      return new ProviderConfigError(
        `every configured Gemini API key was rejected (${this.keys.size} key(s))`,
        lastError,
      );
    }
    if (!attempted) {
      return new ProviderConnectionError(
        'every Gemini key × model is cooling down; try again shortly',
      );
    }
    return lastError instanceof ProviderError
      ? lastError
      : new ProviderConnectionError('Gemini summarization request failed', lastError);
  }

  /** One blocking round-trip asking for a JSON minutes object. */
  private async generate(
    client: GoogleGenAI,
    model: string,
    systemInstruction: string,
    reminder: string,
    wrappedTranscript: string,
  ): Promise<MeetingMinutesDraft> {
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [{ text: wrappedTranscript }, { text: reminder }],
        },
      ],
      config: {
        systemInstruction,
        // Ask for a document, not prose. The model still has to honor the shape
        // inside; this only removes the "parse JSON out of a sentence" failure.
        responseMimeType: 'application/json',
      },
    });

    const body = (response.text ?? '').trim();
    if (!body) {
      throw new ProviderResponseError(`${model} returned an empty response`);
    }
    return this.parse(body, model);
  }

  /**
   * Parse the model's JSON into a draft, defensively.
   *
   * A malformed body is a response-shape failure, not a transport one — the
   * request succeeded and the model simply did not produce the object it was
   * asked for. Every array coerces to `[]` and every missing string to `''`
   * rather than throwing on a partial object: a minutes pass over a short
   * exchange legitimately has no decisions or action items, and that must read
   * as an empty list, not as a failed generation.
   */
  private parse(body: string, model: string): MeetingMinutesDraft {
    let raw: RawMinutes;
    try {
      raw = JSON.parse(body) as RawMinutes;
    } catch {
      throw new ProviderResponseError(`${model} returned non-JSON minutes`);
    }
    return {
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      keyPoints: asStringArray(raw.keyPoints),
      decisions: asStringArray(raw.decisions),
      actionItems: asActionItems(raw.actionItems),
      model,
    };
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asActionItems(value: unknown): MeetingMinutesDraft['actionItems'] {
  if (!Array.isArray(value)) return [];
  const items: MeetingMinutesDraft['actionItems'] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.description !== 'string' || !e.description) continue;
    items.push({
      description: e.description,
      owner: typeof e.owner === 'string' ? e.owner : null,
      dueDate: typeof e.dueDate === 'string' ? e.dueDate : null,
    });
  }
  return items;
}

// Meeting minutes over an OpenAI-compatible chat endpoint.
//
// The same pass the Gemini provider makes — the same instruction, the same
// fenced transcript, the same reminder, one blocking JSON answer — over the
// wire every other host in this package speaks. JSON mode asks for a document
// rather than prose, and the answer goes through the shared draft parser, so
// what counts as usable minutes does not depend on which host wrote them.
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import type {
  MeetingMinutesDraft,
  SummarizationProvider,
  SummarizationRequest,
} from '../../interfaces/summarization-provider.js';
import {
  buildMinutesInstruction,
  buildMinutesReminder,
  wrapMinutesTranscript,
} from '../gemini/minutes-prompt-builder.js';
import { truncate } from '../http-util.js';
import { parseMinutesDraft } from '../minutes-draft-parser.js';

/**
 * Ceiling on one minutes pass. Measured at a 5.9 s median on Command Code's
 * gemini-3.7-flash; bounded well short of a reader's patience so a fallback
 * still has time to answer the same press of Generate.
 */
export const SUMMARIZATION_TIMEOUT_MS = 30_000;

/** A whole conversation's minutes, with room to spare. */
const MAX_OUTPUT_TOKENS = 4_000;

/** One fenced block around the whole answer, which some proxies add in JSON mode. */
const FENCED = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;

export interface OpenAiCompatibleSummarizationConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  name?: string;
  extraBody?: Record<string, unknown>;
  timeoutMs?: number;
}

interface CompletionBody {
  choices?: { message?: { content?: string | null } }[];
}

export class OpenAiCompatibleSummarizationProvider implements SummarizationProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly extraBody: Record<string, unknown>;
  private readonly timeoutMs: number;

  constructor(config: OpenAiCompatibleSummarizationConfig) {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) throw new ProviderConfigError('Summarization requires an apiKey');
    const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '');
    if (!baseUrl) throw new ProviderConfigError('Summarization requires a baseUrl');
    if (!config.model) throw new ProviderConfigError('Summarization requires a model');
    this.apiKey = apiKey;
    this.endpoint = `${baseUrl}/chat/completions`;
    this.model = config.model;
    this.name = config.name ?? 'openai-compatible';
    this.extraBody = config.extraBody ?? {};
    this.timeoutMs = config.timeoutMs ?? SUMMARIZATION_TIMEOUT_MS;
  }

  async summarize(req: SummarizationRequest): Promise<MeetingMinutesDraft> {
    const body = {
      // Caller extensions first, as everywhere on this wire: a vendor flag can
      // add a field but never replace one this class depends on.
      ...this.extraBody,
      model: this.model,
      stream: false,
      max_tokens: MAX_OUTPUT_TOKENS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildMinutesInstruction(req.language) },
        {
          role: 'user',
          content: `${wrapMinutesTranscript(req.transcript)}\n\n${buildMinutesReminder()}`,
        },
      ],
    };

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderConnectionError(`${this.name} ${this.model} minutes failed`, err);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderResponseError(
        `${this.name} ${this.model} minutes answered ${response.status}: ${truncate(detail)}`,
        response.status,
      );
    }

    const content = ((await response.json()) as CompletionBody).choices?.[0]?.message?.content;
    const text = (content ?? '').trim();
    if (!text) throw new ProviderResponseError(`${this.model} returned an empty response`);
    return parseMinutesDraft(text.replace(FENCED, '$1').trim(), this.model);
  }
}

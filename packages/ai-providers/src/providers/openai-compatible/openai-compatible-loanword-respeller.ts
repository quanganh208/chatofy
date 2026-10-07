import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import type {
  LoanwordRespellRequest,
  LoanwordRespeller,
} from '../../interfaces/loanword-respeller.js';
import { truncate } from '../http-util.js';
import {
  LOANWORD_RESPELLING_INSTRUCTION,
  loanwordRespellingMessage,
} from './loanword-respelling-prompt.js';

/**
 * Ceiling on one respelling, end to end.
 *
 * It runs after the translation and the turn's final event waits for it, so
 * this is time a reader waits for the line. Measured against the production
 * host on 2026-10-07 over 42 calls: p50 599 ms, p90 894 ms, max 1003 ms. A
 * respelling that misses the ceiling is simply not applied.
 */
export const RESPELL_TIMEOUT_MS = 1_200;

/** Enough for a few dozen short spellings; the answer is never prose. */
const MAX_OUTPUT_TOKENS = 256;

export interface OpenAiCompatibleLoanwordRespellerConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  name?: string;
  /** The host row's own request fields — the same ones its translation sends. */
  extraBody?: Record<string, unknown>;
  maxOutputTokensField?: 'max_tokens' | 'max_completion_tokens';
  timeoutMs?: number;
}

interface CompletionBody {
  choices?: { message?: { content?: string | null } }[];
}

/**
 * Loanword respelling against any OpenAI-compatible chat endpoint.
 *
 * One non-streaming JSON-mode request: the answer is a small map, nothing reads
 * it until it is whole, and a stream would only add a parser. The same host and
 * model as the translation, so no second key or second rate limit exists.
 */
export class OpenAiCompatibleLoanwordRespeller implements LoanwordRespeller {
  readonly name: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly extraBody: Record<string, unknown>;
  private readonly maxOutputTokensField: 'max_tokens' | 'max_completion_tokens';
  private readonly timeoutMs: number;

  constructor(config: OpenAiCompatibleLoanwordRespellerConfig) {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) throw new ProviderConfigError('Loanword respelling requires an apiKey');
    const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '');
    if (!baseUrl) throw new ProviderConfigError('Loanword respelling requires a baseUrl');
    if (!config.model) throw new ProviderConfigError('Loanword respelling requires a model');
    this.apiKey = apiKey;
    this.endpoint = `${baseUrl}/chat/completions`;
    this.model = config.model;
    this.name = config.name ?? 'openai-compatible';
    this.extraBody = config.extraBody ?? {};
    this.maxOutputTokensField = config.maxOutputTokensField ?? 'max_tokens';
    this.timeoutMs = config.timeoutMs ?? RESPELL_TIMEOUT_MS;
  }

  async respell(request: LoanwordRespellRequest): Promise<Record<string, string | null>> {
    if (request.spans.length === 0) return {};
    const body = {
      ...this.extraBody,
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      [this.maxOutputTokensField]: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: LOANWORD_RESPELLING_INSTRUCTION },
        { role: 'user', content: loanwordRespellingMessage(request) },
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
      throw new ProviderConnectionError(`${this.name} ${this.model} respelling failed`, err);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderResponseError(
        `${this.name} ${this.model} respelling answered ${response.status}: ${truncate(detail)}`,
        response.status,
      );
    }

    const content = ((await response.json()) as CompletionBody).choices?.[0]?.message?.content;
    return parseProposals(content, request.spans);
  }
}

/**
 * The model's answer as a span → spelling map, keeping only the spans asked.
 *
 * Anything else — a malformed body, a non-string value, a key nobody asked
 * about — is dropped rather than thrown: an answer this call cannot use costs
 * the turn its respelling, never its line.
 */
export function parseProposals(
  content: string | null | undefined,
  spans: readonly string[],
): Record<string, string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content ?? '');
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const answer = parsed as Record<string, unknown>;
  const proposals: Record<string, string | null> = {};
  for (const span of spans) {
    const value = answer[span];
    if (typeof value === 'string') proposals[span] = value;
    else if (value === null) proposals[span] = null;
  }
  return proposals;
}

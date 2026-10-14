import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import type {
  HomophoneRepairRequest,
  LoanwordProposal,
  LoanwordRespellRequest,
  LoanwordRespeller,
  RecognizerFusionRequest,
} from '../../interfaces/loanword-respeller.js';
import { truncate } from '../http-util.js';
import {
  HOMOPHONE_REPAIR_INSTRUCTION,
  homophoneRepairMessage,
  LOANWORD_RESPELLING_INSTRUCTION,
  LOANWORD_RESPELLING_INSTRUCTION_HAN,
  loanwordRespellingMessage,
} from './loanword-respelling-prompt.js';
import {
  RECOGNIZER_FUSION_INSTRUCTION,
  recognizerFusionMessage,
} from './recognizer-fusion-prompt.js';

/**
 * Ceiling on one respelling, end to end.
 *
 * It runs after the translation and the turn's final event waits for it, so
 * this is time a reader waits for the line. Measured against the production
 * host on 2026-10-07 over 42 calls: p50 599 ms, p90 894 ms, max 1003 ms. A
 * respelling that misses the ceiling is simply not applied.
 */
export const RESPELL_TIMEOUT_MS = 1_200;

/**
 * Ceiling on one homophone repair, end to end.
 *
 * Longer than {@link RESPELL_TIMEOUT_MS} on purpose. A repair runs beside the
 * translation, and a turn waits for it until 250 ms past the translation, not
 * for a fixed time. When the host is slow the translation is slow too: on
 * 2026-10-13 its p50 moved from ~0.9 s to ~1.3 s within an hour. So a 1.2 s
 * cut would lose repairs that land inside the grace. Not much longer either,
 * because an answer after the grace is thrown away while the request still
 * holds a connection on the translation's own host and key.
 */
export const HOMOPHONE_REPAIR_TIMEOUT_MS = 2_500;

/**
 * Enough for one turn's words: a turn is cut at 8 s, about 40 Vietnamese
 * syllables, and each is a token or two.
 */
const MAX_FUSION_OUTPUT_TOKENS = 400;

/** Enough for a few dozen short spellings; the answer is never prose. */
const MAX_OUTPUT_TOKENS = 256;

/**
 * Enough for a spelling and its rendering per span, which is about twice what
 * a spelling alone takes.
 */
const MAX_OUTPUT_TOKENS_HAN = 512;

export interface OpenAiCompatibleLoanwordRespellerConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  name?: string;
  /** The host row's own request fields — the same ones its translation sends. */
  extraBody?: Record<string, unknown>;
  maxOutputTokensField?: 'max_tokens' | 'max_completion_tokens';
  timeoutMs?: number;
  /** Ceiling on a homophone repair; see {@link HOMOPHONE_REPAIR_TIMEOUT_MS}. */
  repairTimeoutMs?: number;
}

interface CompletionBody {
  choices?: { message?: { content?: string | null } }[];
}

/**
 * Loanword respelling, homophone repair and recognizer fusion against any
 * OpenAI-compatible chat endpoint.
 *
 * One non-streaming JSON-mode request each: the answer is a small map, nothing reads
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
  private readonly repairTimeoutMs: number;

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
    this.repairTimeoutMs = config.repairTimeoutMs ?? HOMOPHONE_REPAIR_TIMEOUT_MS;
  }

  async respell(request: LoanwordRespellRequest): Promise<Record<string, LoanwordProposal>> {
    if (request.spans.length === 0) return {};
    const han = request.translationInHan === true;
    const content = await this.complete(
      han ? LOANWORD_RESPELLING_INSTRUCTION_HAN : LOANWORD_RESPELLING_INSTRUCTION,
      loanwordRespellingMessage(request),
      han ? MAX_OUTPUT_TOKENS_HAN : MAX_OUTPUT_TOKENS,
      'respelling',
      this.timeoutMs,
    );
    return parseProposals(content, request.spans, han);
  }

  async repairHomophones(request: HomophoneRepairRequest): Promise<unknown[]> {
    if (!request.transcript.trim()) return [];
    const content = await this.complete(
      HOMOPHONE_REPAIR_INSTRUCTION,
      homophoneRepairMessage(request),
      MAX_OUTPUT_TOKENS,
      'homophone repair',
      this.repairTimeoutMs,
    );
    return parseCorrections(content);
  }

  /**
   * Under the homophone repair's ceiling, for the same reason: it runs beside
   * the translation and a turn waits for it only until the grace after that.
   */
  async fuseRecognizers(request: RecognizerFusionRequest): Promise<unknown> {
    if (!request.transcript.trim() || request.alternates.length === 0) return undefined;
    const content = await this.complete(
      RECOGNIZER_FUSION_INSTRUCTION,
      recognizerFusionMessage(request),
      MAX_FUSION_OUTPUT_TOKENS,
      'recognizer fusion',
      this.repairTimeoutMs,
    );
    return parseObject(content)?.text;
  }

  /** One non-streaming JSON-mode completion; the answer's content, unparsed. */
  private async complete(
    system: string,
    user: string,
    maxOutputTokens: number,
    what: string,
    timeoutMs: number,
  ): Promise<string | null | undefined> {
    const body = {
      ...this.extraBody,
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      [this.maxOutputTokensField]: maxOutputTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderConnectionError(`${this.name} ${this.model} ${what} failed`, err);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderResponseError(
        `${this.name} ${this.model} ${what} answered ${response.status}: ${truncate(detail)}`,
        response.status,
      );
    }

    return ((await response.json()) as CompletionBody).choices?.[0]?.message?.content;
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
  /** Whether a `{spelling, rendering}` object is a valid answer; else only strings. */
  rendered = false,
): Record<string, LoanwordProposal> {
  const answer = parseObject(content);
  if (!answer) return {};
  const proposals: Record<string, LoanwordProposal> = {};
  for (const span of spans) {
    if (!Object.hasOwn(answer, span)) continue;
    const value = answer[span];
    if (value === null) proposals[span] = null;
    else if (!rendered && typeof value === 'string') proposals[span] = value;
    else if (rendered && typeof value === 'object' && !Array.isArray(value)) {
      const { spelling, rendering } = value as Record<string, unknown>;
      if (typeof spelling === 'string' && typeof rendering === 'string') {
        proposals[span] = { spelling, rendering };
      }
    }
  }
  return proposals;
}

/**
 * The model's `corrections` list, unchecked, or empty when the answer is not
 * the asked-for shape. Judging each entry is `acceptHomophoneRepairs`' job.
 */
export function parseCorrections(content: string | null | undefined): unknown[] {
  const corrections = parseObject(content)?.corrections;
  return Array.isArray(corrections) ? corrections : [];
}

/** `content` as a JSON object, or null for anything else. */
function parseObject(content: string | null | undefined): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content ?? '');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

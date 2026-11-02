// A second pass over a finished turn's translation, on a stronger model.
//
// Not streamed: nobody reads it while it is written, because the draft is
// already on screen and is only replaced once the whole edit is in. And
// defensive about what comes back, since a wrong edit replaces a line that was
// already right: anything that does not look like a translation of this turn
// answers `null` and the draft stands.
import {
  ProviderConfigError,
  ProviderConnectionError,
  ProviderResponseError,
} from '../../errors/provider-errors.js';
import type {
  TranslationPolishRequest,
  TranslationPolisher,
} from '../../interfaces/translation-polisher.js';
import { leaksForeignScript, toTargetScript } from '../../text/translation-script.js';
import { stripTranscriptTags } from '../gemini/prompt-builder.js';
import type { LlmCallListener } from '../../interfaces/llm-call-event.js';
import { truncate } from '../http-util.js';
import { emitLlmCall, promptHash, usageFields, type OpenAiUsage } from './llm-call-reporting.js';
import { buildPolishInstruction, buildPolishUserMessage } from './translation-polish-prompt.js';

/**
 * Ceiling on one polish. Generous next to the translation's, because nobody is
 * waiting on it — but bounded, because an answer that lands after the reader
 * has moved several lines on is a line changing under them for little reason.
 */
export const POLISH_TIMEOUT_MS = 8_000;

/** A turn is at most ~8 s of speech; this is several times its translation. */
const MAX_OUTPUT_TOKENS = 600;

export interface OpenAiCompatibleTranslationPolisherConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  name?: string;
  extraBody?: Record<string, unknown>;
  maxOutputTokensField?: 'max_tokens' | 'max_completion_tokens';
  timeoutMs?: number;
  /** Told about every request this polisher makes, after it settles. */
  onCall?: LlmCallListener;
}

interface CompletionBody {
  choices?: { message?: { content?: string | null } }[];
  usage?: OpenAiUsage | null;
}

export class OpenAiCompatibleTranslationPolisher implements TranslationPolisher {
  readonly name: string;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly extraBody: Record<string, unknown>;
  private readonly maxOutputTokensField: 'max_tokens' | 'max_completion_tokens';
  private readonly timeoutMs: number;
  private readonly onCall: LlmCallListener | undefined;

  constructor(config: OpenAiCompatibleTranslationPolisherConfig) {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) throw new ProviderConfigError('Translation polishing requires an apiKey');
    const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '');
    if (!baseUrl) throw new ProviderConfigError('Translation polishing requires a baseUrl');
    if (!config.model) throw new ProviderConfigError('Translation polishing requires a model');
    this.apiKey = apiKey;
    this.endpoint = `${baseUrl}/chat/completions`;
    this.model = config.model;
    this.name = config.name ?? 'openai-compatible';
    this.extraBody = config.extraBody ?? {};
    this.maxOutputTokensField = config.maxOutputTokensField ?? 'max_tokens';
    this.timeoutMs = config.timeoutMs ?? POLISH_TIMEOUT_MS;
    this.onCall = config.onCall;
  }

  async polish(req: TranslationPolishRequest): Promise<string | null> {
    const body = {
      // Caller extensions first, as everywhere on this wire: a vendor flag can
      // add a field but never replace one this class depends on.
      ...this.extraBody,
      model: this.model,
      stream: false,
      [this.maxOutputTokensField]: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: buildPolishInstruction(req.sourceLanguage, req.targetLanguage) },
        { role: 'user', content: buildPolishUserMessage(req) },
      ],
    };

    const started = Date.now();
    let ok = false;
    let usage: OpenAiUsage | null | undefined;
    let content: string | null | undefined;
    try {
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
        throw new ProviderConnectionError(`${this.name} ${this.model} polish failed`, err);
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new ProviderResponseError(
          `${this.name} ${this.model} polish answered ${response.status}: ${truncate(detail)}`,
          response.status,
        );
      }

      const parsed = (await response.json()) as CompletionBody;
      ok = true;
      usage = parsed.usage;
      content = parsed.choices?.[0]?.message?.content;
    } finally {
      emitLlmCall(this.onCall, {
        kind: 'polish',
        host: this.name,
        model: this.model,
        ms: Date.now() - started,
        ok,
        ...usageFields(usage),
        promptHash: promptHash(this.model, body.messages),
      });
    }
    return this.accept(req, content ?? '');
  }

  /** The edit, or `null` when it should not replace the draft. */
  private accept(req: TranslationPolishRequest, content: string): string | null {
    const edited = stripTranscriptTags(content)
      .replace(/<\/?draft>/gi, '')
      .trim();
    if (!edited) return null;
    // A runaway answer — the context translated too, or commentary — is not
    // an edit of this turn.
    if (edited.length > 2 * req.draft.length + 40) return null;
    if (leaksForeignScript(req.sourceLanguage, req.targetLanguage, req.source, edited)) return null;
    const rendered = toTargetScript(req.targetLanguage, edited);
    return rendered === req.draft.trim() ? null : rendered;
  }
}

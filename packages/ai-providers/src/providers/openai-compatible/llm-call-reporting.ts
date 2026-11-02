// What every OpenAI-compatible provider here needs in order to report a call:
// the token counts out of a response's `usage`, a hash of the prompt that
// carries no text, and a listener call that can never fail the request.
//
// Shared rather than repeated in each provider because the three read the same
// field shapes from the same hosts, and a fourth copy is how one provider ends
// up counting cached tokens differently from the rest.
import { createHash } from 'node:crypto';
import type { LlmCallEvent, LlmCallListener } from '../../interfaces/llm-call-event.js';

/**
 * The `usage` object of a chat completion, as the hosts this package talks to
 * send it. DeepSeek reports cache hits as `prompt_cache_hit_tokens`; OpenAI and
 * most proxies as `prompt_tokens_details.cached_tokens`.
 */
export interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

export type UsageFields = Pick<LlmCallEvent, 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>;

/** The event's token fields from a response's `usage`; empty when there was none. */
export function usageFields(usage: OpenAiUsage | null | undefined): UsageFields {
  if (!usage) return {};
  const fields: UsageFields = {};
  if (typeof usage.prompt_tokens === 'number') fields.inputTokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') fields.outputTokens = usage.completion_tokens;
  const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  if (typeof cached === 'number') fields.cachedInputTokens = cached;
  return fields;
}

/**
 * First 8 hex chars of sha256 over the model and the messages exactly as sent.
 *
 * Two requests with the same hash sent the same prompt, which is what a memo
 * could have answered without a call. The text itself never leaves here.
 */
export function promptHash(model: string, messages: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify({ model, messages })).digest('hex').slice(0, 8);
}

/** Hand the event to the listener, if any. Metrics never fail a turn. */
export function emitLlmCall(listener: LlmCallListener | undefined, event: LlmCallEvent): void {
  if (!listener) return;
  try {
    listener(event);
  } catch {
    // A broken listener costs the measurement, never the request it measured.
  }
}

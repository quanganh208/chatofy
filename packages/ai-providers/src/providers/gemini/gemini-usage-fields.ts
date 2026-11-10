// Token counts out of a Gemini response's `usageMetadata`, in the shape every
// other provider reports them.
//
// Thinking tokens are billed as output, so they are added into `outputTokens`:
// a reasoning model's spend would otherwise read as a fraction of what the bill
// says. A field the response does not carry stays undefined rather than 0, so
// "the host reported nothing" stays distinguishable from "the host reported 0".
import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import type { UsageFields } from '../openai-compatible/llm-call-reporting.js';

export function geminiUsageFields(
  usage: GenerateContentResponseUsageMetadata | null | undefined,
): UsageFields {
  if (!usage) return {};
  const fields: UsageFields = {};
  if (typeof usage.promptTokenCount === 'number') fields.inputTokens = usage.promptTokenCount;
  const candidates = usage.candidatesTokenCount;
  const thoughts = usage.thoughtsTokenCount;
  if (typeof candidates === 'number' || typeof thoughts === 'number') {
    fields.outputTokens = (candidates ?? 0) + (thoughts ?? 0);
  }
  if (typeof usage.cachedContentTokenCount === 'number') {
    fields.cachedInputTokens = usage.cachedContentTokenCount;
  }
  return fields;
}

import { Logger } from '@nestjs/common';
import type { LlmCallEvent } from '@chatofy/ai-providers';

const logger = new Logger('LlmCall');

/**
 * One log line per paid model request, in a fixed `key=value` shape that
 * `benchmarks/call-budget/analyze.mjs` parses.
 *
 * The log is the only sink, as it is for turn metrics: what a turn costs is read
 * off these lines for a window of time, and writing them must never add latency
 * to, or fail, the request they describe. No text from the prompt or the answer
 * is ever written here; `h=` is a hash for spotting identical prompts.
 */
export function logLlmCall(event: LlmCallEvent): void {
  logger.log(formatLlmCall(event));
}

/** The line {@link logLlmCall} writes, for one event. Missing counts print `-`. */
export function formatLlmCall(event: LlmCallEvent): string {
  const count = (value: number | undefined) =>
    value === undefined ? '-' : String(value);
  return (
    `llm kind=${event.kind} purpose=${event.purpose ?? '-'} host=${event.host} ` +
    `model=${event.model} ms=${event.ms} ok=${event.ok ? 1 : 0} ` +
    `in=${count(event.inputTokens)} out=${count(event.outputTokens)} ` +
    `cached=${count(event.cachedInputTokens)} h=${event.promptHash}`
  );
}

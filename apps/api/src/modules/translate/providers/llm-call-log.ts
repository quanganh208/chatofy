import { Logger } from '@nestjs/common';
import type { LlmCallEvent } from '@chatofy/ai-providers';

import { llmCallScope } from '../../usage/llm-call-scope';
import { currentLlmCallSink } from '../../usage/llm-call-sink';

const logger = new Logger('LlmCall');

/**
 * One log line per paid model request, in a fixed `key=value` shape that
 * `benchmarks/call-budget/analyze.mjs` parses.
 *
 * Writing them must never add latency to, or fail, the request they describe.
 * No text from the prompt or the answer is ever written here; `h=` is a hash
 * for spotting identical prompts.
 */
export function logLlmCall(event: LlmCallEvent): void {
  logger.log(formatLlmCall(event));
}

/**
 * The `onCall` every provider is built with: the unchanged log line, then the
 * event handed to the usage sink with the async scope it was emitted in, which
 * is how a call is attributed to a user and a turn.
 *
 * The sink is guarded here as well as by the provider's own `try`, so a broken
 * sink can cost the row but never the log line or the request.
 */
export function recordLlmCall(event: LlmCallEvent): void {
  logLlmCall(event);
  try {
    currentLlmCallSink()?.record(event, llmCallScope.getStore());
  } catch (err) {
    logger.warn(
      `llm call not recorded: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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

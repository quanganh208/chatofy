/**
 * One request a provider made to a paid language model, reported after it
 * settles.
 *
 * Exists because the cost of a turn could not be read off the logs: the
 * translation lines did not say which lane asked (a provisional preview, a
 * speculative guess or the final answer), no provider read the response's
 * token counts, and a successful polish was not logged at all. Every later
 * decision about which calls a turn can do without is a comparison of these
 * events before and after.
 *
 * Carries no text. {@link LlmCallEvent.promptHash} is how two requests that
 * sent byte-identical prompts are recognised — the measure of what a memo would
 * save — without a transcript ever reaching a log line.
 */

/** What the request was for. One value per method a provider exposes. */
export type LlmCallKind =
  | 'translate'
  | 'polish'
  | 'respell'
  | 'fusion'
  | 'homophones'
  | 'digest'
  // A summarization provider's two methods: meeting minutes and a conversation title.
  | 'minutes'
  | 'title';

/**
 * Which lane of a turn asked for a translation. Logged only: a provider must
 * never behave differently because of it.
 *
 * `chat` is a meeting's typed message, which is not a turn at all; it has its
 * own lane so it never inflates the per-turn count of the `final` one.
 */
export type LlmCallPurpose = 'live' | 'speculation' | 'final' | 'retry' | 'block' | 'chat';

export interface LlmCallEvent {
  kind: LlmCallKind;
  purpose?: LlmCallPurpose;
  /** The provider's `name`, which is how a host is told apart in logs. */
  host: string;
  model: string;
  /** Wall time of this one HTTP request, failures included. */
  ms: number;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /** Input tokens the host billed as a prompt-cache hit, when it reports them. */
  cachedInputTokens?: number;
  /** First 8 hex chars of sha256 over `JSON.stringify({ model, messages })`. Never the text itself. */
  promptHash: string;
}

/**
 * Receives every {@link LlmCallEvent}. A listener that throws must not fail the
 * request that produced the event; providers call it inside a `try`.
 */
export type LlmCallListener = (event: LlmCallEvent) => void;

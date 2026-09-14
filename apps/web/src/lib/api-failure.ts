import { ApiClientError } from '@chatofy/api-client';

/**
 * Why a write failed, from the caller's point of view.
 *
 * - `retryable` — a network error, a 5xx, or a throttle. Sending the same body
 *   again can succeed, so a Retry control is honest.
 * - `terminal` — the same body will never succeed. Offering "retry" forever is a
 *   lie.
 */
export type ApiFailure = 'retryable' | 'terminal';

/**
 * Statuses that no amount of resending will fix.
 *
 * - **400** the body is malformed or over a schema bound.
 * - **401** recovery already ran once inside the client and did not help.
 * - **409** storage is unconfigured or unreachable in a way the server calls
 *   settled — the recording routes answer this rather than a 5xx precisely so
 *   the message survives `AllExceptionsFilter`'s blanking.
 * - **413** the parser refused on length, before any route ran. Resending the
 *   same bytes cannot make them smaller.
 * - **415** the bytes are not a container this API stores. A different recording
 *   might be; this one will not become one.
 */
const TERMINAL = new Set([400, 401, 409, 413, 415]);

/**
 * Classify a failed API call.
 *
 * Anything unrecognized is `retryable`. Defaulting the other way would abandon
 * work a transient blip could have saved — the rule `use-conversation-save.ts`
 * established for the transcript, applied to the recording too so the two halves
 * of one conversation cannot disagree about whether a Retry button is honest.
 *
 * Lifted out of that hook when the recording upload became a second caller: two
 * copies of this rule would drift, and the drift would be invisible until a user
 * saw Retry on one half and not the other for the same outage.
 */
export function classifyApiFailure(err: unknown): ApiFailure {
  if (err instanceof ApiClientError && TERMINAL.has(err.status)) return 'terminal';
  return 'retryable';
}
